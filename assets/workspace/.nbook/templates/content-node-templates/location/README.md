# Location 模板说明

> 模板位置: `content-node-templates/location/index.md`
> 对应项目实例: `workspace/qi-shou-fan-shen-cheng-ding-fu/lorebook/location/` (V1 地点: `深圳科技园` / `古村北路` / `东海市金融工作办公室` / `群租房` / `古村公园城中村窝棚`)

## §1 用途

地点卡模板，用于城市 / 建筑 / 场景建模。`index.md` 是基础卡（地点设定 + 关键事件 + 角色常驻）。

跟其他 entity 区别：

- `location` 与 `character` / `faction` / `item` 字段集同构
- `location` 经常作为 `chapter` 的发生地点（`refs` 反向引用）
- `location` 可嵌套（城市 → 区 → 建筑 → 房间）

## §2 必填字段

- `title` (string) — 地点名（e.g. "深圳科技园"）
- `type` (enum, = "location") — 节点类型，必填
- `status` (enum) — `draft` / `pending` / `active` / `archived`
- `summary` (string) — 一句话地点定位
- `retrieval.enabled` (bool, default true)

## §3 可选字段

- `subtype` (string?) — 地点细分（如 `city` / `district` / `building` / `room` / `outdoor`）
- `aliases` (string[]) — 别名
- `tags` (string[]) — 中文短标签
- `icon` (string?) — Lucide 图标名
- `refs` (string[]) — 引用常驻角色 / 关联地点
- `retrieval.trigger` (string[]?)
- `governance.source` / `governance.review`
- `ext` (object?) — 自由扩展（e.g. `ext.coordinates` 经纬度 / `ext.area` 面积 / `ext.opened-at` 启用时间）

## §4 填表示例

```yaml
---
title: 群租房
type: location
subtype: room
status: active
aliases: [陆深租的群租房, 群租屋, basement room]
tags:
  - 陆深住所
  - 地下室
  - V1 主线
summary: "陆深租住的群租房地下室，木板床 + 隔断墙 + 8 人共用卫生间。V1 主线核心场景。"
refs:
  - ../character/lu-shen/
  - ../location/古村北路/
retrieval:
  enabled: true
  trigger: [群租房, 群租屋, 地下室, basement, 陆深住的地方]
governance:
  source: creation-constitution
  review: approved
---

## 地点设定

- 类型: 地下室单间
- 位置: 古村北路某栋楼 B1 层
- 设施: 木板床 + 床头柜 + 隔断墙 + 共用卫生间

## 关键事件

- Ch.001 陆深起床接单 (开场)
- Ch.005 陆深研究区块链浏览器 (catalyst)
- Ch.010 陆深接闪购订单去 188 号 (break-into-two)
- Ch.045 中点苏念来访 (midpoint)

## 常驻角色

- 陆深 (主)
- 隔壁室友 (次, 短视频声源)
```

## §5 相关模板

- `character/README.md` (本目录) — 地点常驻角色
- `chapter/README.md` (本目录) — 地点出场章节
- `faction/README.md` (本目录) — 地点所有者 / 管辖派系
- `relationship/README.md` (本目录) — 地点作为关系发生地
