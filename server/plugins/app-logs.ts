import { consola } from 'consola'
import { appLogger } from 'nbook/server/app-logs/logger'

type ConsolaLogObject = {
  type?: string
  level?: number
  tag?: string
  args?: unknown[]
}

const globalState = globalThis as typeof globalThis & {
  __nbookAppLogsInstalled?: boolean
}

/**
 * 安装进程级日志桥接。热重载时只安装一次，避免重复写入。
 */
export default defineNitroPlugin(() => {
  if (globalState.__nbookAppLogsInstalled) {
    return
  }
  globalState.__nbookAppLogsInstalled = true

  consola.addReporter({
    log(logObject: ConsolaLogObject) {
      const level = resolveConsolaLevel(logObject)
      void appLogger[level]('consola', {
        type: logObject.type,
        tag: logObject.tag,
        args: logObject.args ?? [],
      })
    },
  })

  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    void appLogger.warn('console.warn', { args }, formatConsoleArgs(args))
  }
  console.error = (...args: unknown[]) => {
    originalError(...args)
    void appLogger.error('console.error', { args }, firstErrorArg(args), formatConsoleArgs(args))
  }

  process.on('unhandledRejection', (reason) => {
    appLogger.fatalSync('process.unhandledRejection', undefined, reason, 'Unhandled promise rejection')
    setImmediate(() => {
      throw reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${String(reason)}`)
    })
  })
  process.on('uncaughtExceptionMonitor', (error) => {
    appLogger.fatalSync('process.uncaughtException', undefined, error, 'Uncaught exception')
  })

  void appLogger.info('app.logs.ready', {
    directory: appLogger.logDirectory,
    currentFile: appLogger.currentFilePath,
    nodeEnv: process.env.NODE_ENV ?? null,
  })
})

function resolveConsolaLevel(logObject: ConsolaLogObject): 'debug' | 'info' | 'warn' | 'error' {
  if (logObject.type === 'error' || logObject.type === 'fatal') {
    return 'error'
  }
  if (logObject.type === 'warn') {
    return 'warn'
  }
  if (typeof logObject.level === 'number' && logObject.level >= 4) {
    return 'debug'
  }
  return 'info'
}

function firstErrorArg(args: unknown[]): unknown {
  return args.find(arg => arg instanceof Error)
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return arg.message
    }
    if (typeof arg === 'string') {
      return arg
    }
    return typeof arg
  }).join(' ')
}
