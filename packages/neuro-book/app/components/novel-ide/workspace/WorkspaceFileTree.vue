<script setup lang="ts">
import WorkspaceFileNode from "nbook/app/components/novel-ide/workspace/WorkspaceFileNode.vue";
import type {WorkspaceFileNode as WorkspaceFileNodeDto} from "nbook/app/stores/novel-ide";
import {
    buildWorkspaceFileTreeIndexMaps,
    buildWorkspaceFileTree,
    buildWorkspaceNodeDropContextMap,
    canDropOnWorkspaceNode,
    collectVisibleTreePaths,
    resolveWorkspaceNodeDropPosition,
    resolveWorkspaceTailDrop,
    sanitizeExpandedPaths,
    type WorkspaceFileDropState,
    type WorkspaceFileMovePayload,
    type WorkspaceTreeNode,
    workspaceFileTreeContextKey,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const props = withDefaults(defineProps<{
    nodes: WorkspaceFileNodeDto[];
    selectedPath: string;
    expandedPaths: string[];
    forcedExpandedPaths?: string[];
}>(), {
    forcedExpandedPaths: () => [],
});

const emit = defineEmits<{
    (e: "update:expandedPaths", value: string[]): void;
    (e: "select", node: WorkspaceFileNodeDto): void;
    (e: "open", node: WorkspaceFileNodeDto): void;
    (e: "move", payload: WorkspaceFileMovePayload): void;
    (e: "node-contextmenu", node: WorkspaceFileNodeDto, event: MouseEvent): void;
    (e: "root-contextmenu", event: MouseEvent): void;
}>();

const draggedPath = ref<string | null>(null);
const dropState = ref<WorkspaceFileDropState>({
    targetPath: null,
    position: null,
    visualKind: null,
});

const roots = computed(() => buildWorkspaceFileTree(props.nodes));
const selectedPath = computed(() => props.selectedPath);
const expandedPathSet = computed(() => new Set(props.expandedPaths));
const forcedExpandedPathSet = computed(() => new Set(props.forcedExpandedPaths));
const visibleExpandedPathSet = computed(() => new Set([
    ...props.expandedPaths,
    ...props.forcedExpandedPaths,
]));
const indexMaps = computed(() => buildWorkspaceFileTreeIndexMaps(roots.value));
const dropContextMap = computed(() => buildWorkspaceNodeDropContextMap(roots.value, visibleExpandedPathSet.value));

const treeRootRef = ref<HTMLElement | null>(null);
const focusedPath = ref("");
const visiblePaths = computed(() => collectVisibleTreePaths(roots.value, visibleExpandedPathSet.value));
// 漫游 tabindex 落点：焦点路径失效时依次回退到选中节点、第一个可见节点
const tabbablePath = computed(() => {
    if (focusedPath.value && visiblePaths.value.includes(focusedPath.value)) {
        return focusedPath.value;
    }
    if (props.selectedPath && visiblePaths.value.includes(props.selectedPath)) {
        return props.selectedPath;
    }
    return visiblePaths.value[0] ?? "";
});

watch(() => props.selectedPath, (path) => {
    if (path) {
        focusedPath.value = path;
    }
});

/**
 * 把键盘焦点移到指定可见节点，并同步漫游 tabindex 落点。
 */
function focusTreePath(path: string): void {
    focusedPath.value = path;
    void nextTick(() => {
        const row = treeRootRef.value?.querySelector(`[data-tree-path="${CSS.escape(path)}"]`);
        if (row instanceof HTMLElement) {
            row.focus();
        }
    });
}

/**
 * 鼠标/触摸聚焦行时同步漫游 tabindex 落点。
 */
const handleRowFocus = (node: WorkspaceTreeNode): void => {
    focusedPath.value = node.path;
};

/**
 * 树键盘导航（ARIA treeview）：方向键移动/展开/收起，Enter 激活。
 */
const handleRowKeydown = (node: WorkspaceTreeNode, event: KeyboardEvent): void => {
    const paths = visiblePaths.value;
    const currentIndex = paths.indexOf(node.path);
    const isBranch = node.isDirectory && node.children.length > 0;
    const isOpenVisible = isBranch && visibleExpandedPathSet.value.has(node.path);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = event.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
        const nextPath = paths[nextIndex];
        if (nextPath) {
            focusTreePath(nextPath);
        }
        return;
    }
    if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const targetPath = event.key === "Home" ? paths[0] : paths[paths.length - 1];
        if (targetPath) {
            focusTreePath(targetPath);
        }
        return;
    }
    if (event.key === "ArrowRight") {
        if (!isBranch) {
            return;
        }
        event.preventDefault();
        if (!isOpenVisible) {
            expandPath(node.path);
        } else {
            const firstChildPath = node.children[0]?.path;
            if (firstChildPath) {
                focusTreePath(firstChildPath);
            }
        }
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isOpenVisible && expandedPathSet.value.has(node.path)) {
            collapsePath(node.path);
            return;
        }
        const parentPath = indexMaps.value.parentByPath.get(node.path);
        if (parentPath) {
            focusTreePath(parentPath);
        }
        return;
    }
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isBranch) {
            toggleExpanded(node);
        } else {
            openNode(node);
        }
    }
};

/**
 * 展开指定目录（键盘 ArrowRight）。
 */
function expandPath(path: string): void {
    if (expandedPathSet.value.has(path)) {
        return;
    }
    emit("update:expandedPaths", [...props.expandedPaths, path]);
}

/**
 * 收起指定目录（键盘 ArrowLeft，只收用户展开态；搜索强制展开态回退到父级导航）。
 */
function collapsePath(path: string): void {
    emit("update:expandedPaths", props.expandedPaths.filter((item) => item !== path));
}

/**
 * 清空拖拽态。
 */
const clearDragState = (): void => {
    draggedPath.value = null;
    dropState.value = {
        targetPath: null,
        position: null,
        visualKind: null,
    };
};

/**
 * 仅清空落点高亮，不中断当前拖拽。
 */
const clearDropState = (): void => {
    dropState.value = {
        targetPath: null,
        position: null,
        visualKind: null,
    };
};

/**
 * 选中节点。
 */
const selectNode = (node: WorkspaceFileNodeDto): void => {
    emit("select", node);
};

/**
 * 双击打开节点并保留标签。
 */
const openNode = (node: WorkspaceFileNodeDto): void => {
    emit("open", node);
};

/**
 * 切换目录展开态。
 */
const toggleExpanded = (node: WorkspaceFileNodeDto): void => {
    if (!node.isDirectory) {
        return;
    }

    const nextExpandedPaths = new Set(props.expandedPaths);
    if (nextExpandedPaths.has(node.path)) {
        nextExpandedPaths.delete(node.path);
    } else {
        nextExpandedPaths.add(node.path);
    }
    emit("update:expandedPaths", [...nextExpandedPaths]);
};

/**
 * 开始拖拽一个真实路径。
 */
const startDrag = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    draggedPath.value = node.path;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.path);
    }
};

/**
 * 按当前节点和鼠标位置刷新落点。
 */
const updateDropState = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null) {
        return;
    }
    if (!canDropOnWorkspaceNode(draggedPath.value, node.path, indexMaps.value.parentByPath)) {
        clearDropState();
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = resolveWorkspaceNodeDropPosition(node, event, dropContextMap.value.get(node.path) ?? null);
};

/**
 * 刷新子节点尾部落点。
 */
const updateTailDropState = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null) {
        return;
    }
    if (!canDropOnWorkspaceNode(draggedPath.value, node.path, indexMaps.value.parentByPath)) {
        clearDropState();
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = resolveWorkspaceTailDrop(node, dropContextMap.value.get(node.path) ?? null);
};

/**
 * 提交拖拽移动。
 */
const commitDrop = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null || dropState.value.position === null || dropState.value.visualKind === null) {
        clearDragState();
        return;
    }

    emit("move", {
        sourcePath: draggedPath.value,
        targetPath: dropState.value.targetPath,
        position: dropState.value.position,
        visualKind: dropState.value.visualKind,
    });
    clearDragState();
};

/**
 * 空白根区域可以作为移动到根的目标。
 */
const handleRootDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (draggedPath.value === null) {
        return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]')) {
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = {
        targetPath: null,
        position: "root",
        visualKind: "root-line",
    };
};

/**
 * 提交根级 drop。
 */
const handleRootDrop = (event: DragEvent): void => {
    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]') && dropState.value.position !== "root") {
        return;
    }
    commitDrop(event);
};

/**
 * 根区域右键仅在空白区触发。
 */
const handleRootContextMenu = (event: MouseEvent): void => {
    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]')) {
        return;
    }
    emit("root-contextmenu", event);
};

watch(roots, () => {
    const nextExpandedPaths = sanitizeExpandedPaths(roots.value, props.expandedPaths);
    if (nextExpandedPaths.length !== props.expandedPaths.length) {
        emit("update:expandedPaths", nextExpandedPaths);
    }
}, {immediate: true});

provide(workspaceFileTreeContextKey, {
    selectedPath,
    expandedPathSet,
    forcedExpandedPathSet,
    dropState,
    draggedPath,
    tabbablePath,
    selectNode,
    openNode,
    toggleExpanded,
    startDrag,
    updateDropState,
    updateTailDropState,
    commitDrop,
    clearDragState,
    emitNodeContextMenu: (node, event) => emit("node-contextmenu", node, event),
    handleRowFocus,
    handleRowKeydown,
});
</script>

<template>
    <!-- 工作区文件树 -->
    <div
        ref="treeRootRef"
        class="relative h-full min-h-[120px] select-none pb-6"
        data-role="workspace-file-tree-root"
        role="tree"
        aria-label="项目文件树"
        @dragover="handleRootDragOver"
        @drop="handleRootDrop"
        @contextmenu.prevent.stop="handleRootContextMenu"
    >
        <WorkspaceFileNode
            v-for="node in roots"
            :key="node.path"
            :node="node"
            :depth="0"
            :indent="18"
        />

        <div v-if="dropState.visualKind === 'root-line'" class="mt-1 h-[2px] rounded-full bg-[var(--accent-main)]"></div>
    </div>
</template>
