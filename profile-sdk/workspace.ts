// Profile SDK 子入口：把 project workspace 资源暴露给 Profile 作者。
// Profile 沙箱要求只允许白名单 specifier；项目工作区读写是常见需求但不能
// 暴露 nbook/server/* 整条路径，因此通过 SDK 子模块再导出。
import {
    PROJECT_MANIFEST_FILE as projectManifestFileHost,
    readProjectManifest as readProjectManifestHost,
} from "nbook/server/workspace-files/project-workspace";
import type {ProjectManifest} from "nbook/server/workspace-files/project-workspace";

export const PROJECT_MANIFEST_FILE: typeof projectManifestFileHost = projectManifestFileHost;

export const readProjectManifest: typeof readProjectManifestHost = readProjectManifestHost;

export type {ProjectManifest};
