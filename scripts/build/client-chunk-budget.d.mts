/** 单类体积上限。 */
export interface ClientChunkClassBudget {
    maxRawBytes: number;
    maxGzipBytes: number;
}

/** Client chunk 体积预算（当前登记值见实现文件头部注释的实测依据）。 */
export interface ClientChunkBudget {
    eager: ClientChunkClassBudget;
    perChunk: ClientChunkClassBudget;
    maxTotalGzipBytes: number;
}

/** 一次预算检查的实测摘要。 */
export interface ClientChunkBudgetSummary {
    chunks: number;
    eagerFiles: string[];
    eagerRawBytes: number;
    eagerGzipBytes: number;
    totalGzipBytes: number;
    worst: {name: string; rawBytes: number; gzipBytes: number};
}

export const CLIENT_CHUNK_BUDGET: ClientChunkBudget;

/** 从 client manifest 提取 eager chunk 文件集合；manifest 缺失或结构漂移抛错。 */
export function resolveEagerChunkFiles(manifestSource: string): string[];

/** 断言 Product 镜像满足客户端体积预算；违规抛错。 */
export function assertClientChunkBudget(
    imageRoot: string,
    budget?: ClientChunkBudget,
): Promise<ClientChunkBudgetSummary>;
