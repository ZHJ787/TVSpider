# TVSpider

## 项目结构

```
TVSpider/
├── js/                     # 爬虫脚本
│   ├── jable.js           # JableTV 爬虫
│   └── spider.js          # 基础爬虫类
├── lib/                    # 公共库
├── nodejs/
│   ├── src/
│   │   ├── index.js       # 入口文件
│   │   ├── index.config.js # 配置文件
│   │   └── spider/        # 爬虫实现
│   └── dist/              # 构建产物
├── build.py               # 配置生成脚本
├── 18_tv_config.json      # TVBox 配置
└── 18_open_config.json    # CatOpen 配置
```

## 使用说明

### 生成配置

```bash
python build.py --key jable
```

### 构建产物

```bash
cd nodejs
npm install
npm run build
```

构建产物位于 `nodejs/dist/`：
- `index.js` / `index.js.md5`
- `index.config.js` / `index.config.js.md5`

### 接入方式

- **TVBox**：使用 `18_tv_config.json`
- **CatVodOpen**：使用 `nodejs/dist/index.js.md5` 
>
> [阿里Token获取](https://alist.nn.ci/zh/guide/drivers/aliyundrive.html)
>
> nodejs 部分只生成代码，需要手动build，区分18+