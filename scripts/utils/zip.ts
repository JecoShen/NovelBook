import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'

import yazl from 'yazl'

export type ZipEntry
  = | { kind: 'file', source: string, archivePath: string }
    | { kind: 'directory', archivePath: string }

/** 使用 yazl 的惰性文件读取和 Node pipeline 写入 zip，避免 Windows 大目录耗尽文件句柄。 */
export async function writeZipArchive(output: string, entries: ZipEntry[], progressEvery = 1000): Promise<void> {
  await mkdir(dirname(output), { recursive: true })
  const zip = new yazl.ZipFile()
  for (const [index, entry] of entries.entries()) {
    const archivePath = entry.archivePath.replaceAll('\\', '/')
    if (entry.kind === 'file') zip.addFile(entry.source, archivePath)
    else zip.addEmptyDirectory(archivePath)
    const count = index + 1
    if (count % progressEvery === 0 || count === entries.length) console.log(`ZIP 已登记 ${count}/${entries.length} 个条目`)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(output))
}
