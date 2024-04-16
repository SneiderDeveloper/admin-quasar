/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.config.js > pwa > workboxPluginMode is set to "InjectManifest"
 */

// @ts-ignore Disable worbox Logs
self.__WB_DISABLE_DEV_LOGS = true;

declare const self: ServiceWorkerGlobalScope &
  typeof globalThis & { skipWaiting: () => void }

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { ExpirationPlugin } from 'workbox-expiration'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { Queue, QueueStore } from 'workbox-background-sync'

// Use with precache injection
const wbManifest = [ ...self.__WB_MANIFEST ]

// filtering resources to cache
const assets = wbManifest.filter((asset: { url: string, revision: string }) => {
  return asset.url.includes('src_modules');
});

// precacheAndRoute(wbManifest)

const requestPOST = new Map<string, Request>()
const sentPOST = new Map<string, any>()
const QUEUE_NAME = 'requests'
const CACHE_NAME = 'stale-while-revalidate'

// const plugins = [
//   new ExpirationPlugin({
//     maxEntries: 50,
//     maxAgeSeconds: 60 * 60 // 1 Hour
//   }),
// ]

const match = request => {
  const url = new URL(request.request.url)
  const isApi = url.pathname.startsWith('/api/')

  const isRefresh = request.request.headers.get('x-refresh')
  const cache = request.request.headers.get('x-cache')

  return isApi && isRefresh && !cache
}

// registerRoute(match, new NetworkFirst({
//   cacheName: CACHE_NAME,
//   plugins
// }))

// registerRoute(
//   request => !match(request), 
//   new CacheFirst({
//     cacheName: CACHE_NAME,
//     plugins
//   })
// )

const postMessage = (message: string) => {
  self.clients.matchAll()
    .then(clients => {
      clients.forEach(client => client.postMessage(message))
    })
}

const decode = (data: ArrayBuffer) => {
  if (!data) return null

  try {
    const decoder = new TextDecoder('utf-8')
    const body = decoder.decode(data)
    
    if (!body) return ''
    return JSON.parse(body)
  } catch (error) {
    console.log('Error decoding data', error)
    throw new Error(error)
  }
}

const transformReadableStreamToObject = async (data: ReadableStream): Promise<any> => {
  if (!data) return
  try {
    const reader = data.getReader()
    let result = '';
    while (true) {
      const { done, value } = await reader.read()
      if (done) break;
      result += new TextDecoder().decode(value)
    }
    return JSON.parse(result)
  } catch (err) {
    console.error('Error reading data', err)
    throw new Error(err)
  }
}

const getIdFromUrl = (fullUrl: string) => {
  if (!fullUrl) return
  const url = new URL(fullUrl)
  const pathParts = url.pathname.split('/')
  return pathParts[pathParts.length - 1]
}

const groupRequestsById = (entries) => {
  return entries.reduce((acc, request) => {
    if (request.requestData.method !== 'PUT') return acc
    
    const id = getIdFromUrl(request.requestData?.url)
  
    acc[id] ? acc[id].push(request) : acc[id] = [request]
    
    return acc
  }, {})
}

// const queueStore = new QueueStore(QUEUE_NAME)

// const squashRequests = async () => {
//   const entries = await queueStore.getAll()

//   const groupedUpdateRequests = groupRequestsById(entries)

//   try {
//     await Promise.all(Object.keys(groupedUpdateRequests).map(async key => {
//       const group = groupedUpdateRequests[key]
  
//       if (group.length > 1) {
//         let body = null
  
//         await Promise.all(group.map(async (item: any  ) => {
//           const bodyArrayBuffer = item.requestData.body

//           const { 
//             attributes: attributesPUT 
//           } = decode(bodyArrayBuffer)
  
//           await queueStore.deleteEntry(item.id)
  
//           body = {
//             attributes: {
//               ...body?.attributes,
//               ...attributesPUT
//             }
//           }
//         }))

//         const requestData = group[0].requestData
  
//         const mergeRequest = new Request(requestData?.url, {
//           ...requestData,
//           body: JSON.stringify(body),
//         })
  
//         await queue.pushRequest({
//           request: mergeRequest
//         })
        
//       }
//     }))
//   } catch (error) {
//     console.log('error', error)
//   }

// }

const createNewRequest = (url, request, attr) => {
  console.log('request ->', request)

  return new Request(url ? url : request.url, {
    body: request.body,
    cache: request.cache,
    credentials: request.credentials,
    headers: request.headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
    ...attr
  })
}

// const mergePostAndPutRequests = async (entry, entries) => {
//   try {
//     let body = null
//     const { 
//       attributes: { offline_id }, 
//       attributes: attributesPOST 
//     } = await transformReadableStreamToObject(entry.body)

//     await Promise.all(entries.map(async (request: any) => {
//       if (request.requestData.method !== 'PUT') return

//       const id = getIdFromUrl(request.requestData.url)

//       if (String(id) === String(offline_id)) {
//         const bodyArrayBuffer = request.requestData.body

//         const { 
//           attributes: attributesPUT 
//         } = await decode(bodyArrayBuffer)

//         delete attributesPUT.id

//         await queueStore.deleteEntry(request.id)

//         body = JSON.stringify({
//           attributes: {
//             ...attributesPOST,
//             ...attributesPUT,
//           }
//         })
//       }
//     }))

//     if (body) {
//       const mergeRequest = createNewRequest(entry.url, entry, { body })

//       requestPOST.delete(offline_id)

//       return mergeRequest
//     }
//   } catch (error) {
//     console.log('Error merging requests', error)
//   }
// }

const replaceRequestUrlWithStoredUrl = async (clonedRequest, requestId) => {
  console.log('requestId de metadata', requestId)

  if (sentPOST.has(String(requestId))) {

    console.log('url antes de replace', clonedRequest.url)
    const url = clonedRequest.url.replace(requestId, sentPOST.get(requestId))
    console.log('url despues de replace', url)

    const newRequest = createNewRequest(url, clonedRequest, { body: null, method: 'DELETE' })

    console.log('newRequest', newRequest)

    return newRequest
  } 
}

// const queue = new Queue(QUEUE_NAME, {
//   onSync: async ({ queue }) => {
//     let entry
//     const retryCounters = new Map<string, number>()
    
//     // Group PUT requests to then send a single PUT request.
//     await squashRequests()
    
//     const entries = await queueStore.getAll()

//     while (entry = await queue.shiftRequest()) {
//       try {
//         if (entry.request.method === 'POST') {
//           // If from the same POST request there are PUT requests, 
//           // then it takes the corresponding PUT requests and merges 
//           // them. Then it sends a single POST request.
//           const mergeRequest = await mergePostAndPutRequests(entry.request.clone(), entries)
//           if (mergeRequest) {
//             entry.request = mergeRequest
//           }
//         }

//         if (entry.request.method === 'DELETE') {
//           // If a POST request is successful and then that same record 
//           // is deleted during the disconnected state, then the fake ID 
//           // contained in the URL is replaced by the real ID generated 
//           // by the database as a response to the successful request.
//           console.log('original method', entry.request.method)
//           const newRequest = await replaceRequestUrlWithStoredUrl(entry.request.clone(), entry.metadata?.requestId)
//           if (newRequest) {
//             console.log('New method', newRequest.method)
//             entry.request = newRequest
//           }
//         }

//         if (entry.metadata?.squash) return
//         const response = await fetch(entry.request)
//         console.log('response', response)

//         if (entry.request.method === 'POST') {
//           const { data } = await response.json()
//           // Save the ID generated by the server 
//           // to later use it in the URL of the DELETE 
//           // request corresponding to the created record.
//           sentPOST.set(data.offlineId, data.id)
//         }

//         postMessage('successful')

//         retryCounters.delete(entry.request.url)
//       } catch (error) {
//         // If a queued request fails, it will try two more times, 
//         // and if unsuccessful, it will remove it from the queue.
//         const retryCounter = retryCounters.get(entry.request.url) || 0

//         if (retryCounter < 3) {
//           retryCounters.set(entry.request.url, retryCounter + 1);
//           await queue.unshiftRequest(entry);
//         } else {
//           retryCounters.delete(entry.request.url);
//         }
//       }
//     }

//     postMessage('sync-data')
//   },
// })

// self.addEventListener('fetch', (event) => {
//   const supportedMethods = [
//     'POST',
//     'PUT',
//     'DELETE',
//   ]

//   if (!supportedMethods.includes(event.request.method)) {
//     return
//   }

//   const bgSyncLogic = async () => {
//     try {
//       const response = await fetch(event.request.clone())
//       return response
//     } catch (error) {
//       const path = new URL(event.request.url).pathname
//       if(path.startsWith('/api/') && !navigator.onLine) {

//         let requestId = null

//         if (event.request.method === 'POST') {
//           const { 
//             attributes: { offline_id } 
//           } = await transformReadableStreamToObject(event.request.clone().body)
//           requestPOST.set(String(offline_id), event.request.clone())
//         }

//         if (event.request.method === 'DELETE') {
//           console.log('DELETE url', event.request.url)
//           const id = getIdFromUrl(event.request.url)
//           console.log('DELETE id', id)

//           if (requestPOST.has(String(id))) {
//             console.log('DELETE requestId', id)
//             requestId = id
//           }
//         }

//         await queue.pushRequest({
//           request: event.request,
//           metadata: {
//             requestId
//           }
//         })

//         postMessage('queue-request')
//       }
      
//       return error
//     }
//   }

//   event.respondWith(bgSyncLogic())
// })