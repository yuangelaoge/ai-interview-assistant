const path = require('path')

// __RVB_WS_SAME_PORT_PROXY__
// Expose the internal WebSocket server through the same public HTTP port.
// NAT/frp users only need to publish the HTTP port; ws://host:port/ws/rooms/*
// is proxied to 127.0.0.1:WS_PORT inside the host process.
const net = require('net')
const http = require('http')
const __rvbOriginalCreateServer = http.createServer
function __rvbProxyWsUpgrade(req, socket, head) {
  const url = String((req && req.url) || '')
  if (!(url === '/ws' || url === '/ws/' || url.indexOf('/ws/rooms') === 0)) return false
  if (req.__rvbWsProxyHandled) return true
  req.__rvbWsProxyHandled = true
  const wsPort = parseInt(process.env.WS_PORT || '3001', 10)
  const target = net.connect(wsPort, '127.0.0.1')
  let settled = false
  target.on('connect', function() {
    settled = true
    const lines = [req.method + ' / HTTP/' + req.httpVersion]
    for (const i in req.rawHeaders) {
      if (Number(i) % 2 === 0) lines.push(req.rawHeaders[i] + ': ' + req.rawHeaders[Number(i) + 1])
    }
    target.write(lines.join('\\r\\n') + '\\r\\n\\r\\n')
    if (head && head.length) target.write(head)
    socket.pipe(target)
    target.pipe(socket)
  })
  target.on('error', function() {
    if (!settled) {
      try { socket.write('HTTP/1.1 502 Bad Gateway\\r\\nConnection: close\\r\\n\\r\\n') } catch {}
    }
    try { socket.destroy() } catch {}
  })
  socket.on('error', function() { try { target.destroy() } catch {} })
  return true
}
http.createServer = function rvbCreateServerWithWsProxy() {
  const server = __rvbOriginalCreateServer.apply(this, arguments)
  server.on('upgrade', function rvbDirectWsProxy(req, socket, head) {
    __rvbProxyWsUpgrade(req, socket, head)
  })
  const originalOn = server.on.bind(server)
  server.on = function rvbServerOn(eventName, listener) {
    if (eventName === 'upgrade' && typeof listener === 'function') {
      return originalOn(eventName, function rvbUpgradeRouter(req, socket, head) {
        if (__rvbProxyWsUpgrade(req, socket, head)) return
        return listener(req, socket, head)
      })
    }
    return originalOn(eventName, listener)
  }
  return server
}

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = {"env":{},"webpack":null,"typescript":{"ignoreBuildErrors":true},"typedRoutes":false,"distDir":"./.next","cleanDistDir":true,"assetPrefix":"","cacheMaxMemorySize":52428800,"configOrigin":"next.config.ts","useFileSystemPublicRoutes":true,"generateEtags":true,"pageExtensions":["tsx","ts","jsx","js"],"poweredByHeader":true,"compress":true,"images":{"deviceSizes":[640,750,828,1080,1200,1920,2048,3840],"imageSizes":[32,48,64,96,128,256,384],"path":"/_next/image","loader":"default","loaderFile":"","domains":[],"disableStaticImages":false,"minimumCacheTTL":14400,"formats":["image/webp"],"maximumRedirects":3,"maximumResponseBody":50000000,"dangerouslyAllowLocalIP":false,"dangerouslyAllowSVG":false,"contentSecurityPolicy":"script-src 'none'; frame-src 'none'; sandbox;","contentDispositionType":"attachment","localPatterns":[{"pathname":"**","search":""}],"remotePatterns":[],"qualities":[75],"unoptimized":false},"devIndicators":{"position":"bottom-left"},"onDemandEntries":{"maxInactiveAge":60000,"pagesBufferLength":5},"basePath":"","sassOptions":{},"trailingSlash":false,"i18n":null,"productionBrowserSourceMaps":false,"excludeDefaultMomentLocales":true,"reactProductionProfiling":false,"reactStrictMode":null,"reactMaxHeadersLength":6000,"httpAgentOptions":{"keepAlive":true},"logging":{},"compiler":{},"expireTime":31536000,"staticPageGenerationTimeout":60,"output":"standalone","modularizeImports":{"@mui/icons-material":{"transform":"@mui/icons-material/{{member}}"},"lodash":{"transform":"lodash/{{member}}"}},"outputFileTracingRoot":"C:\\Users\\lngsc\\Documents\\GitHub\\v0-game-menu-design\\v0-game-menu-design","cacheComponents":false,"cacheLife":{"default":{"stale":300,"revalidate":900,"expire":4294967294},"seconds":{"stale":30,"revalidate":1,"expire":60},"minutes":{"stale":300,"revalidate":60,"expire":3600},"hours":{"stale":300,"revalidate":3600,"expire":86400},"days":{"stale":300,"revalidate":86400,"expire":604800},"weeks":{"stale":300,"revalidate":604800,"expire":2592000},"max":{"stale":300,"revalidate":2592000,"expire":31536000}},"cacheHandlers":{},"experimental":{"useSkewCookie":false,"cssChunking":true,"multiZoneDraftMode":false,"appNavFailHandling":false,"prerenderEarlyExit":true,"serverMinification":true,"linkNoTouchStart":false,"caseSensitiveRoutes":false,"dynamicOnHover":false,"preloadEntriesOnStart":true,"clientRouterFilter":true,"clientRouterFilterRedirects":false,"fetchCacheKeyPrefix":"","proxyPrefetch":"flexible","optimisticClientCache":true,"manualClientBasePath":false,"cpus":31,"memoryBasedWorkersCount":false,"imgOptConcurrency":null,"imgOptTimeoutInSeconds":7,"imgOptMaxInputPixels":268402689,"imgOptSequentialRead":null,"imgOptSkipMetadata":null,"isrFlushToDisk":true,"workerThreads":false,"optimizeCss":false,"nextScriptWorkers":false,"scrollRestoration":false,"externalDir":false,"disableOptimizedLoading":false,"gzipSize":true,"craCompat":false,"esmExternals":true,"fullySpecified":false,"swcTraceProfiling":false,"forceSwcTransforms":false,"largePageDataBytes":128000,"typedEnv":false,"parallelServerCompiles":false,"parallelServerBuildTraces":false,"ppr":false,"authInterrupts":false,"webpackMemoryOptimizations":false,"optimizeServerReact":true,"viewTransition":false,"removeUncaughtErrorAndRejectionListeners":false,"validateRSCRequestHeaders":false,"staleTimes":{"dynamic":0,"static":300},"reactDebugChannel":false,"serverComponentsHmrCache":true,"staticGenerationMaxConcurrency":8,"staticGenerationMinPagesPerWorker":25,"transitionIndicator":false,"inlineCss":false,"useCache":false,"globalNotFound":false,"browserDebugInfoInTerminal":false,"lockDistDir":true,"isolatedDevBuild":true,"proxyClientMaxBodySize":10485760,"hideLogsAfterAbort":false,"mcpServer":true,"turbopackFileSystemCacheForDev":true,"turbopackFileSystemCacheForBuild":false,"turbopackInferModuleSideEffects":false,"optimizePackageImports":["lucide-react","date-fns","lodash-es","ramda","antd","react-bootstrap","ahooks","@ant-design/icons","@headlessui/react","@headlessui-float/react","@heroicons/react/20/solid","@heroicons/react/24/solid","@heroicons/react/24/outline","@visx/visx","@tremor/react","rxjs","@mui/material","@mui/icons-material","recharts","react-use","effect","@effect/schema","@effect/platform","@effect/platform-node","@effect/platform-browser","@effect/platform-bun","@effect/sql","@effect/sql-mssql","@effect/sql-mysql2","@effect/sql-pg","@effect/sql-sqlite-node","@effect/sql-sqlite-bun","@effect/sql-sqlite-wasm","@effect/sql-sqlite-react-native","@effect/rpc","@effect/rpc-http","@effect/typeclass","@effect/experimental","@effect/opentelemetry","@material-ui/core","@material-ui/icons","@tabler/icons-react","mui-core","react-icons/ai","react-icons/bi","react-icons/bs","react-icons/cg","react-icons/ci","react-icons/di","react-icons/fa","react-icons/fa6","react-icons/fc","react-icons/fi","react-icons/gi","react-icons/go","react-icons/gr","react-icons/hi","react-icons/hi2","react-icons/im","react-icons/io","react-icons/io5","react-icons/lia","react-icons/lib","react-icons/lu","react-icons/md","react-icons/pi","react-icons/ri","react-icons/rx","react-icons/si","react-icons/sl","react-icons/tb","react-icons/tfi","react-icons/ti","react-icons/vsc","react-icons/wi"],"trustHostHeader":false,"isExperimentalCompile":false},"htmlLimitedBots":"[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight","bundlePagesRouterDependencies":false,"configFileName":"next.config.ts","serverExternalPackages":["adm-zip","ws"],"turbopack":{"root":"C:\\Users\\lngsc\\Documents\\GitHub\\v0-game-menu-design\\v0-game-menu-design"},"distDirRoot":".next"}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});