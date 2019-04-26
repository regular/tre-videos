// jshint -W018
const h = require('mutant/html-element')
const Value = require('mutant/value')
const MutantArray = require('mutant/array')
const Str = require('tre-string')
const TextTracks = require('tre-texttracks')
const computed = require('mutant/computed')
const debug = require('debug')('tre-videos:index')
const dragAndDrop = require('./drag-and-drop')
const setStyle = require('module-styles')('tre-videos')
const activityIndicator = require('tre-activity-indicator')
const WatchMerged = require('tre-prototypes')
const {isMsgId} = require('ssb-ref')

const {importFiles, factory} = require('./common')

module.exports = function(ssb, opts) {
  opts = opts || {}
  const getSrcObs = Source(ssb)
  const {prototypes} = opts
  if (!prototypes) throw new Error('need prototypes!')

  const watchMerged = WatchMerged(ssb)
  const renderTextTrack = TextTracks(ssb, {prototypes})

  styles()

  return function(kv, ctx) {
    if (!kv) return
    const {value} = kv
    if (!value) return
    if (
      !(value.type === 'video') &&
      !(value.content && value.content.type === 'video')
    ) return
    ctx = ctx || {}
    const previewObs = ctx.previewObs || Value(kv)
    const previewContentObs = computed(previewObs, kv => kv && kv.value.content)
    const {currentLanguageObs, languagesObs} = ctx
    const ownContentObs = ctx.contentObs || Value({})
    const srcObs = getSrcObs(previewContentObs)
    const uploading = Value(false)
    const progress = Value(0)
    const {isEmbedded, autoplay} = ctx

    function set(o) {
      ownContentObs.set(Object.assign({}, ownContentObs(), o))
    }

    const renderStr = Str({
      save: text => {
        set({name: text})
      }
    })

    const inEditor = (ctx.where || '').includes('editor')
    // make sure all videos are stopped
    // and their sockets are released
    // See https://github.com/videojs/video.js/issues/455
    if (window.stop) window.stop()

    const textTrackRefs = computed(previewContentObs, content => {
      return content && content.texttracks || []
    })

    const textTracks = computed(textTrackRefs, refs => {
      let els = refs.map(ref=>{
        if (!isMsgId(ref)) {
          console.warn('textrack ref is invalid', ref)
          return
        }
        return computed(watchMerged(ref, {allowAllAuthors: true}), kv => {
          if (!kv) return []
          const activeObs = computed(currentLanguageObs, currLanguage => {
            const {language, kind, name} = kv.value.content
            if (language && currLanguage) {
              return language == currLanguage
            }
            // none language-specific streams should be
            if (!language) return true
            // if there's only one, it's the default
            return textTrackRefs.length == 1
          })

          const t = renderTextTrack(kv, {
            where: 'stage',
            defaultObs: activeObs,
            modeObs: computed(activeObs, a => {
              if (kv && kv.value.content.kind == 'metadata') {
                return 'hidden'
              }
              return a ? 'showing' : 'disabled'
            })
          })
          return t
        })
      })
      els = els.filter(e => Boolean(e))
      return MutantArray(els)
    })

    let el
    function replay() {
      load()
      el.play()
    }

    function load() {
      el.setAttribute('src', srcObs())
      console.log('Loading video meta data ...')
      el.load()
    }

    el = h('video.tre-video', Object.assign({}, dragAndDrop(upload), {
      src: srcObs,
      width: computed(previewContentObs, c => c && c.width || 640),
      height: computed(previewContentObs, c => c && c.height || 480),
      //preload: "none",
      autoplay,
      // see https://developers.google.com/web/updates/2017/09/autoplay-policy-changes
      // and https://cs.chromium.org/chromium/src/media/base/media_switches.cc?sq=package:chromium&type=cs&l=179
      muted: true,

      'ev-replay': function() {
        replay()
      },
      'ev-ended': e => {
        if (!e.bubbles) {
          if (el.getAttribute('src') == '') return
          console.warn('tre-video: video ended, freeing network connection')
          // this event doesn't bubble normally, but we want it to!
          el.setAttribute('src', '')
          el.load()
          sendEvent(el, 'ended')
        }
      },
      'ev-loadedmetadata': () => {
        if (!el) {
          console.warn('loadedmetadata withoud video element')
          return
        }
        console.log(`loaded video props: ${el.videoWidth}x${el.videoHeight} ${el.duration}`)
        uploading.set(false)
        set({
          width: el.videoWidth,
          height: el.videoHeight,
          duration: el.duration
        })
      }
    }), textTracks)

    if (!inEditor) return el

    return h('.tre-videos-editor', [
      h('h1', renderStr(computed(previewObs, kv => kv && kv.value.content.name || 'No Name'))),
      computed(uploading, u => u ? [
        activityIndicator({}),
        h('.upload-progress', computed(progress, p => {
          if (p>0.99) return "Please wait ..."
          return Math.floor(p*100) + '%'
        }))
      ] : [
        el,
        h('.tre-videos-controls', [
          h('button', {
            'ev-click': ()=> load()
          }, 'Load'),
          h('button', {
            'ev-click': ()=> replay()
          }, 'Play')
        ])
      ])
    ])

    function upload(file) {
      return doImport()
      
      function doImport() {
        uploading.set(true)
        console.log('importing video')
        importFiles(ssb, [file], {prototypes, progress}, (err, content) => {
          if (err) return console.error(err.message)
          console.log('imported', content)
          set(content)
          setTimeout( ()=>{
            load()
          }, 250)
        })
      }
    }
  }
}

module.exports.importFiles = importFiles
module.exports.factory = factory


function Source(ssb) {
  const blobPrefix = Value()
  ssb.ws.getAddress((err, address) => {
    if (err) return console.error(err)
    address = address.replace(/^ws:\/\//, 'http://').replace(/~.*$/, '/blobs/get/')
    blobPrefix.set(address)
  })

  return function getSrcObs(cObs) {
    return computed([blobPrefix, cObs], (bp, content) => {
      if (!bp) return null
      let contentType = content && content.file && content.file.type
      const blob = content && content.blob
      if (!blob) return null
      return `${bp}${encodeURIComponent(blob)}${contentType ? '?contentType=' + encodeURIComponent(contentType) : ''}`
    }, {comparer: (a,b)=>a==b})
  }
}

// -- utils

function sendEvent(el, name) {
  const event = new UIEvent(name, {
    view: window,
    bubbles: true,
    cancelable: true
  })
  return el.dispatchEvent(event)
}


function styles() {
  setStyle(`
    .tre-videos-editor {
      height: 100%;
    }
    .tre-video.empty {
      width: 200px;
      height: 200px;
      border-radius: 10px;
      border: 5px #999 dashed;
    }
    .tre-video.drag-hover {
      border-radius: 10px;
      border: 5px #994 dashed;
    }
    .tre-videos-editor .tre-video {
      width: 100%;
      height: auto;
    }
  `)
}


