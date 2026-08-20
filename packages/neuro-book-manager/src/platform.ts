import { machine } from 'node:os'

import type {
  HostArchitecture,
  HostOperatingSystem,
  HostPlatform,
  InstallProfile,
  InstallationManifest,
  ProductPlatform,
} from '#manager/types'

/** Product平台到公开Release资产名的穷举映射。 */
export const PRODUCT_ASSET_NAMES = {
  'windows-x64': 'neuro-book-product-windows-x64.zip',
  'linux-x64-glibc': 'neuro-book-product-linux-x64-glibc.tar.gz',
  'linux-aarch64-glibc': 'neuro-book-product-linux-aarch64-glibc.tar.gz',
  'darwin-x64': 'neuro-book-product-darwin-x64.tar.gz',
  'darwin-aarch64': 'neuro-book-product-darwin-aarch64.tar.gz',
} as const satisfies Record<ProductPlatform, string>

const ALL_PROFILES = [
  'source-dev',
  'source-product',
  'product-bun',
  'windows-portable',
  'source-docker',
  'ghcr',
] as const satisfies readonly InstallProfile[]

const POSIX_PROFILES = ALL_PROFILES.filter(profile => profile !== 'windows-portable')

const PLATFORM_PROFILES = {
  'windows-x64': ALL_PROFILES,
  'linux-x64-glibc': POSIX_PROFILES,
  'linux-aarch64-glibc': POSIX_PROFILES,
  'darwin-x64': POSIX_PROFILES,
  'darwin-aarch64': POSIX_PROFILES,
} as const satisfies Record<ProductPlatform, readonly InstallProfile[]>

export type PlatformRuntime = {
  platform: NodeJS.Platform
  processArch: NodeJS.Architecture
  nativeMachine: string
  /** Linux检测到glibc时非空；其他宿主不使用。 */
  glibcVersion?: string
}

/** 将Node/Bun与操作系统报告的架构名收敛为Manager领域值。 */
function normalizeArchitecture(value: string, source: string): HostArchitecture {
  const normalized = value.toLocaleLowerCase('en-US')
  if (['x64', 'x86_64', 'amd64'].includes(normalized)) return 'x64'
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64'
  throw new Error(`${source}只支持x64/ARM64，检测到：${value}`)
}

/** 将Node平台名收敛为Manager领域值。 */
function normalizeOperatingSystem(platform: NodeJS.Platform): HostOperatingSystem {
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  if (platform === 'darwin') return 'macos'
  throw new Error(`Manager只支持Windows/Linux/macOS，检测到：${platform}`)
}

/** 根据原生宿主生成唯一Product平台。 */
function resolveProductPlatform(os: HostOperatingSystem, nativeArch: HostArchitecture, glibcVersion?: string): ProductPlatform {
  if (os === 'windows') {
    if (nativeArch !== 'x64') throw new Error(`Windows只支持原生x64，检测到：${nativeArch}`)
    return 'windows-x64'
  }
  if (os === 'linux') {
    if (!glibcVersion) throw new Error('Manager只支持Linux glibc，不支持musl或未知libc。')
    return nativeArch === 'x64' ? 'linux-x64-glibc' : 'linux-aarch64-glibc'
  }
  return nativeArch === 'x64' ? 'darwin-x64' : 'darwin-aarch64'
}

/** 检查宿主原生架构、Manager进程架构与Product平台。 */
export function inspectHostPlatform(runtime: PlatformRuntime = currentPlatformRuntime()): HostPlatform {
  const os = normalizeOperatingSystem(runtime.platform)
  const nativeArch = normalizeArchitecture(runtime.nativeMachine, `${os}宿主`)
  const processArch = normalizeArchitecture(runtime.processArch, 'Manager进程')
  return {
    os,
    nativeArch,
    processArch,
    productPlatform: resolveProductPlatform(os, nativeArch, runtime.glibcVersion),
    libc: os === 'linux' ? 'glibc' : null,
  }
}

/** 收集当前进程的原始宿主报告；测试通过inspectHostPlatform参数注入。 */
function currentPlatformRuntime(): PlatformRuntime {
  const report = process.platform === 'linux'
    ? process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    : undefined
  return {
    platform: process.platform,
    processArch: process.arch,
    nativeMachine: machine(),
    glibcVersion: report?.header?.glibcVersionRuntime,
  }
}

/** 兼容现有调用点的纯Product平台解析入口。 */
export function productPlatform(runtime: { platform: NodeJS.Platform, arch: NodeJS.Architecture, glibcVersion?: string }): ProductPlatform {
  return inspectHostPlatform({
    platform: runtime.platform,
    processArch: runtime.arch,
    nativeMachine: runtime.arch,
    glibcVersion: runtime.glibcVersion,
  }).productPlatform
}

/** 返回当前宿主的Product平台。 */
export function currentProductPlatform(): ProductPlatform {
  const host = inspectHostPlatform()
  assertManagerPlatform(host)
  return host.productPlatform
}

/** 校验Manager宿主平台。 */
export function assertManagerPlatform(host = inspectHostPlatform()): void {
  if (host.nativeArch !== host.processArch) {
    throw new Error(
      `Manager必须使用宿主原生架构的Bun：宿主为${host.nativeArch}，当前进程为${host.processArch}。请安装原生Bun后重试。`,
    )
  }
}

/** 返回指定平台正式支持的Profile。 */
export function supportedProfiles(platform = currentProductPlatform()): readonly InstallProfile[] {
  return PLATFORM_PROFILES[platform]
}

/** 校验当前平台是否支持指定Profile。 */
export function assertProfileSupported(profile: InstallProfile, host = inspectHostPlatform()): void {
  assertManagerPlatform(host)
  if (!supportedProfiles(host.productPlatform).includes(profile)) {
    throw new Error(`${host.productPlatform}不支持${profile} Profile。`)
  }
}

/**
 * 校验Installation Manifest能否由当前原生宿主运行。
 *
 * 容器Product由Container Engine选择镜像平台；其他Product必须与宿主Product平台完全一致。
 */
export function assertInstallationHostCompatible(manifest: InstallationManifest, host = inspectHostPlatform()): void {
  assertProfileSupported(manifest.profile, host)
  const product = manifest.components.product
  if (product && product.provider !== 'container' && product.platform !== host.productPlatform) {
    throw new Error(
      `实例Product平台为${product.platform}，当前宿主为${host.productPlatform}。请在当前平台重新安装，并复用原State Root。`,
    )
  }
}

/** 返回平台可执行文件后缀。 */
export function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}
