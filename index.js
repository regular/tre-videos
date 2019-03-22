// jshint -W018
const h = require('mutant/html-element')
const Value = require('mutant/value')
const Str = require('tre-string')
const computed = require('mutant/computed')
const debug = require('debug')('tre-videos:index')
const dragAndDrop = require('./drag-and-drop')
const setStyle = require('module-styles')('tre-videos')
const activityIndicator = require('tre-activity-indicator')

const {importFiles, factory} = require('./common')

/* Several workarounds for Chrome Issue 234779
 * taken from here:
 * https://bugs.chromium.org/p/chromium/issues/detail?id=234779
 * and here:
 * https://github.com/videojs/video.js/issues/455
 */

module.exports = function(ssb, opts) {
  opts = opts || {}
  const getSrcObs = Source(ssb)
  const {prototypes} = opts
  if (!prototypes) throw new Error('need prototypes!')

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
    const ownContentObs = ctx.contentObs || Value({})
    const src = getSrcObs(previewContentObs)
    const uploading = Value(false)
    const progress = Value(0)
    const {isEmbedded} = ctx

    function set(o) {
      ownContentObs.set(Object.assign({}, ownContentObs(), o))
    }

    const renderStr = Str({
      save: text => {
        set({name: text})
      }
    })

    // if the video is part of the contetnt of
    // another node, we call it embedded
    // (idle loops are videos that are not embedded)

    if (isEmbedded) {
      bus.sendToParentFrame('playback-start', {})
    }
    const inEditor = (ctx.where || '').includes('editor')
    // make sure all videos are stopped
    // and their sockets are released
    // See https://github.com/videojs/video.js/issues/455
    if (window.stop) window.stop()

    let el
    function release() {
      const source = el.querySelector('source')
      console.log('releasing video', source.getAttribute('src', ''))
      source.setAttribute('src', '')
      el.load()
    }

    function replay() {
      const source = el.querySelector('source')
      source.setAttribute('src', src())
      el.load()
      el.play()
    }

    function load() {
      const source = el.querySelector('source')
      source.setAttribute('src', src())
      console.log('Loading video meta data ...')
      el.load()
    }

    el = h('video.tre-video', Object.assign({}, dragAndDrop(upload), {
      hooks: [el => release],
      width: computed(previewContentObs, c => c && c.width || 640),
      height: computed(previewContentObs, c => c && c.height || 480),
      preload: "none",
      //autoplay: "true",
      // see https://developers.google.com/web/updates/2017/09/autoplay-policy-changes
      // and https://cs.chromium.org/chromium/src/media/base/media_switches.cc?sq=package:chromium&type=cs&l=179
      muted: true,

      'ev-replay': function() {
        replay()
      },
      'ev-ended': function() {
        release()
      },
      'ev-loadedmetadata': () => {
        console.log(`loaded video props: ${el.videoWidth}x${el.videoHeight} ${el.duration}`)
        uploading.set(false)
        set({
          width: el.videoWidth,
          height: el.videoHeight,
          duration: el.duration
        })
      }
    }), [
      h('source', {
        src: src()
      }),
    ])

    load()
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
    })
  }
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


