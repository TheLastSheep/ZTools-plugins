# 多引擎批量搜索

输入一次关键词，同时打开多个搜索引擎的结果页。

在 ZTools 里输入一个词，插件会把你勾选的引擎（可以跨分类）全部打开：一次触发，Google、百度、知乎、B 站、GitHub……想看几个就看几个，不用复制粘贴、不用来回切换。引擎按分类管理，勾选即批量搜索。

## 它解决什么问题

普通的搜索插件是「一次一个站」：搜完百度觉得不对，再切到 Google，再切到知乎，关键词要重复输入三遍。这个插件把这件事反过来——**先选好站点组合，再搜一次**。

典型用法：

- 查一个技术问题：Google + Stack Overflow + V2EX + GitHub 同时开
- 看一个产品口碑：知乎 + 小红书 + 微博 + 豆瓣 同时开
- 找资源/教程：B 站 + YouTube + 百度 同时开
- 只想要某个站的结果：点该引擎后面的「搜索」，单发

## 功能

- 关键字触发：`so`、`搜索`、`多搜`
- 全局文本触发：输入任意关键词，选中「多引擎搜索」即可带上关键词进入插件
- 三种搜索方式：单个引擎搜索、搜索本组、批量搜索已勾选引擎
- 分类与引擎管理：新增 / 重命名 / 删除分类，引擎可编辑、删除、上移、下移
- 搜索地址支持 `{q}` 和 `%s` 两种关键词占位符
- 配置支持 JSON 导入、导出、恢复默认，也可直接编辑 JSON 后应用
- 浅色 / 深色主题自动适配

## 默认配置

内置 5 个分类、23 个常用引擎：

| 分类 | 引擎 |
|---|---|
| 搜索引擎 | Google、Bing、百度、DuckDuckGo、Yandex、搜狗 |
| 常用 | 知乎、Bilibili、YouTube、微博、小红书、豆瓣 |
| 论坛 | V2EX、Linux.do、百度贴吧、Reddit |
| 知识 | Wikipedia、萌娘百科、Stack Overflow、Quora |
| 站内搜索 | 少数派、Notion、飞书 |

默认配置只是起点，可在右侧面板自由增删改，或导入自己的 JSON 配置覆盖。

## 使用

1. 在 ZTools 输入 `so`、`搜索` 或 `多搜` 打开插件。
2. 在顶部输入关键词。
3. 勾选需要使用的引擎，点击「批量搜索」，插件会用系统默认浏览器依次打开结果页。

搜索地址示例：

```text
https://www.google.com/search?q={q}
https://www.baidu.com/s?wd=%s
```

## 配置导入格式

```json
{
  "version": 2,
  "groups": [
    {
      "id": "group_search",
      "name": "搜索引擎",
      "engines": [
        { "id": "engine_google", "name": "Google", "url": "https://www.google.com/search?q={q}" }
      ]
    }
  ],
  "selectedIds": ["engine_google"]
}
```

也兼容旧版导出的 `{ "app": ..., "version": 2, "config": { ... } }` 包裹格式，以及 `urls` 作为引擎数组字段名的写法。

## 隐私

插件不联网、不上报任何数据，所有配置仅保存在本机 ZTools 的 `dbStorage` 中；搜索时只调用系统默认浏览器打开链接。

## 文件结构

```text
plugin.json          ZTools 插件配置
index.html           插件主界面
preload.js           读取内置默认配置
default-config.json  默认搜索引擎配置
logo.png             插件图标
vue.global.js        Vue 运行时
```
