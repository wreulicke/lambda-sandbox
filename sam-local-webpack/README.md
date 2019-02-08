
こんにちは。齋藤です。
記事を書いている際に麻婆豆腐の匂いがしてきてお腹が空きました。

今日の記事は クラスメソッド社員がお届けする [AWSサーバーレス Advent Calendar 2017](https://qiita.com/advent-calendar/2017/aws-serverless) の 17日目の記事です。

昨日の記事は [西田さん](https://qiita.com/sutetotanuki) による [「LambdaからカスタムサブセグメントをX-Rayに送信する」](https://dev.classmethod.jp/server-side/serverless/lambda-xray-custom-segment/) でした。

以前作った SAM Local で テストしたアプリケーションをベースに手を加えて
slackへの通知をするLambdaを AWS SAM Localでテストしつつ
デプロイまでしてみます。

今回は webpack で node 向けにトランスパイルしてデプロイしてみます。

今回の記事の内容は次のような内容です。

* アプリケーションを用意する
  * slack の通知を行うコードを TypeScriptで書く
  * SAM ベースの cloudformation の template を書く
  * webpack で bundleする
  * AWS SAM Localでテストしてみる
* デプロイ
  * アプリケーションのデプロイのために s3 bucket の 作成をする
  * sam コマンド経由で アプリケーションの package をする
  * sam コマンド経由で アプリケーションの deploy をする
  * 実際に API Gateway経由で 動作を確認する

今回は次のような構成で動作を確認しました。

* AWS SAM Local 0.2.4
* aws-cli/1.14.10 Python/3.6.3 Darwin/17.3.0 botocore/1.8.14
* npm 5.6.0
* node 9.2.1
* docker

```
$ docker version
Client:
 Version:      17.09.1-ce
 API version:  1.32
 Go version:   go1.8.3
 Git commit:   19e2cf6
 Built:        Thu Dec  7 22:22:25 2017
 OS/Arch:      darwin/amd64

Server:
 Version:      17.09.1-ce
 API version:  1.32 (minimum version 1.12)
 Go version:   go1.8.3
 Git commit:   19e2cf6
 Built:        Thu Dec  7 22:28:28 2017
 OS/Arch:      linux/amd64
 Experimental: true
```

## slack の通知を行うコードを TypeScriptで書く

やっぱり型は欲しいので TypeScriptです。
書きました。

環境変数から slackのアクセストークンを受け取るようにしています。

```typescript
import Lambda from "aws-lambda"

import { WebClient } from "@slack/client"

const token = process.env.SLACK_TOKEN!
const slackClient = new WebClient(token)

function postMessage(event: Lambda.APIGatewayEvent, _: Lambda.Context, callback: Lambda.ProxyCallback) {
  interface RequestBody {
    channel: string
    message: string
  }
  if (event.body == null) {
    callback(null, { statusCode: 400, body: "Bad Request" })
    return
  }

  try {
    const body: Partial<RequestBody> = JSON.parse(event.body)
    if (body.channel == null)
      throw new Error("Cannot read .channel from request body")
    if (body.message == null)
      throw new Error("Cannot read .message from request body")

    slackClient.chat.postMessage(body.channel, body.message, (e, r) => {
      if (e != null || r.ok == false) {
        callback(null, { statusCode: 500, body: "error occured when message post" })
        return
      }
      callback(null, { statusCode: 200, body: "message is posted" })
    })
  } catch (e) {
    callback(null, { statusCode: 400, body: e.message })
  }
}

module.exports = { postMessage }
```

slack の client の 型定義はなかったので
こちらも追加しました。必要なものだけです。

```typescript
declare module "@slack/client" {
  interface OkResult {
    ok: true,
  }
  interface ErrorResult {
    ok: false,
    error: string
  }
  type Result = OkResult | ErrorResult

  interface WebChatApi {
    postMessage(channel: string, text: string, callback: (e: Error, result: Result) => void): void;
  }
  class WebClient {
    constructor(
      token: string
    )
    chat: WebChatApi
  }
  export { WebClient }
}
```

これで大体アプリケーションのコードはできました。
typescriptの設定については [こちら](https://github.com/wreulicke/lambda-sandbox/blob/2f3a02d468957db42177e4d58b6246dd8d8a80dc/sam-local-webpack/tsconfig.json)をご覧ください。

次は AWS SAM Local を使ってテストをしてみましょう。

## SAM ベースの cloudformation の template を書く

AWS SAM Local で作成した APIを定義する サーバーレスアプリケーションモデル (SAM) の テンプレートファイルを書きました。

Parameterで slackのアクセストークンを受け取って
Serverless::Function の環境変数に設定しています。

今回は CodeUriを使って bundle したファイルだけパッケージするようにしています。

CodeUriの挙動に関しては[こちらの記事を](https://dev.classmethod.jp/cloud/aws/understanding-codeuri-property-and-deployment-package-in-serverless-application-model/)ご覧ください。

```yml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: SAM Local test
Parameters:
  SlackToken:
    Type : String
    Description : Enter slack token for bot.
Resources:
  HelloWorld:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: target/
      Handler: index.postMessage
      Runtime: nodejs6.10
      Environment:
        Variables:
          SLACK_TOKEN: !Ref SlackToken
      Events:
        GetResource:
          Type: Api
          Properties:
            Path: /message
            Method: post
```

## webpack で bundleする

webpack 類をインストールしておきます。

```
npm i webpack ts-node typescript ts-loader -D
```

webpack.config.ts はここでは次のような物を用意しました。
テストのために uglify はオフにしています。

```typescript
"use strict"
import * as path from "path"

import * as webpack from "webpack"

const config: webpack.Configuration = {
  devtool: "source-map",
  entry: "./index.ts",
  output: {
    path: path.resolve("./target"),
    filename: "index.js"
  },
  target: "node",
  resolve: {
    extensions: [".json", ".tsx", ".ts", ".js"]
  },
  plugins: [
    // new webpack.optimize.UglifyJsPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.ts?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
}

module.exports = config
```

bundleしてみます。
warning がいっぱい出ますが
ここでは気にせずやっていきます。

```
$ npx webpack
Hash: f5ccf8f32bf275c58f3f
Version: webpack 3.10.0
Time: 3377ms
       Asset     Size  Chunks                    Chunk Names
    index.js  2.35 MB       0  [emitted]  [big]  main
index.js.map  2.92 MB       0  [emitted]         main
  [56] (webpack)/buildin/module.js 517 bytes {0} [built]
 [129] ./index.ts 1.12 kB {0} [built]
 [177] ./node_modules/colors/lib 160 bytes {0} [optional] [built]
 [194] ./node_modules/pkginfo/lib ^.*\/package\.json$ 160 bytes {0} [optional] [built]
    + 337 hidden modules

WARNING in ./node_modules/colors/lib/colors.js
127:29-43 Critical dependency: the request of a dependency is an expression

WARNING in ./node_modules/ws/lib/BufferUtil.js
Module not found: Error: Can't resolve 'bufferutil' ...

WARNING in ./node_modules/ws/lib/Validation.js
Module not found: Error: Can't resolve 'utf-8-validate' ...
```

bundleできました。
target 配下に index.js が出力されているはずです。

## AWS SAM Local でテストしてみる

では、以前の記事を見ながら AWS SAM Local でテストをしてみます。

次のようなJSONファイルを用意しておきます。

```json
{
  "HelloWorld": {
    "SLACK_TOKEN": "<your-slack-token>"
  }
}
```

`template.yml` ファイルが存在するディレクトリで
次のコマンドを使うと 定義してある Serverless::Function を動かすことが可能です。

```
sam local start-api --env-vars env.json
```

curl を使って動かしてみます。

```
$ curl -XPOST http://localhost:3000/message -d '{"channel":"bot", "message":"test"}'
{ "message": "Internal server error" }
```

動きません。

AWS SAM Localを起動しているターミナルに次のようなログが出ていました。
モジュールの初期化に失敗しています。

```
START RequestId: a63f73b8-d205-185a-7374-0a4e56a9b905 Version: $LATEST
module initialization error: Error
    at Function.module.exports.pkginfo.find (/var/task/index.js:51534:11)
    at Function.module.exports.pkginfo.read (/var/task/index.js:51561:22)
    at module.exports.module.exports (/var/task/index.js:51507:21)
    at Object.<anonymous> (/var/task/index.js:51568:1)
    at Object.module.exports.webpackEmptyContext.keys (/var/task/index.js:51574:30)
    at __webpack_require__ (/var/task/index.js:21:30)
    at Object.<anonymous> (/var/task/index.js:26083:39)
    at Object.module.exports.winston (/var/task/index.js:26138:30)
    at __webpack_require__ (/var/task/index.js:21:30)
    at Object.module.exports.old (/var/task/index.js:31491:40)
    at __webpack_require__ (/var/task/index.js:21:30)
    at Object.module.exports.module.exports.ctor.super_ (/var/task/index.js:41412:21)
    at __webpack_require__ (/var/task/index.js:21:30)
    at Object.<anonymous> (/var/task/index.js:41370:14)
    at __webpack_require__ (/var/task/index.js:21:30)
    at Object.<anonymous> (/var/task/index.js:41333:16)
END RequestId: a63f73b8-d205-185a-7374-0a4e56a9b905
REPORT RequestId: a63f73b8-d205-185a-7374-0a4e56a9b905  Duration:206.88 ms       Billed Duration: 0 ms   Memory Size: 0 MB       Max Memory Used: 57 MB
```

bundleされたソースを調べたところ、元のソースを見ると
次のようなコードが書かれていました。

```js
...
var pkginfo = require('pkginfo')(module, 'version', 'name'); // eslint-disable-line no-unused-vars
...
```

slackのクライアントのライブラリは `pkginfo` というモジュールを使って
package.json のデータを読んでいます。
これでは１枚のファイルに bundleできません。

この処理自体は静的に解決できるはずですね。
babelを使って解決しましょう。

### pkginfo の呼び出しを静的にするために babel pluginを書く

babelをインストールしておきます。

```
$ npm i babel-core babel-loader -D
```

この時点で webpack.config.ts は次のような形になりました。

```typescript
"use strict"
import * as path from "path"

import * as webpack from "webpack"

const config: webpack.Configuration = {
  devtool: "source-map",
  entry: "./index.ts",
  output: {
    path: path.resolve("./target"),
    filename: "index.js"
  },
  target: "node",
  resolve: {
    extensions: [".json", ".tsx", ".ts", ".js"]
  },
  plugins: [
    // new webpack.optimize.UglifyJsPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        use: [
          {
            loader: "babel-loader",
          },
        ],
      },
      {
        test: /\.ts?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
}

module.exports = config
```

`.babelrc` も用意しておきます。

```json
{
  "plugins": [
    "./pkginfo.js"
  ]
}
```

では、pkginfoの呼び出しを静的にする babel pluginを書きましょう。

書きました。

```js
// @ts-nocheck
"use strict"

const finder = require("find-package-json")

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (babel) {
  const { types: t } = babel;
  function isRequire(node) {
    return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name == "require"
  }
  function isImportPkginfo(node) {
    return t.isStringLiteral(node.arguments[0]) && node.arguments[0].value === "pkginfo"
  }
  function literal(value) {
    if (typeof value === "string") {
      return t.stringLiteral(value)
    } else if (typeof value === "number") {
      return t.numberLiteral(value)
    }
    throw new Error("Unexpeted type: " + (typeof value))
  }
  return {
    visitor: {
      VariableDeclaration(path, state) {
        path.traverse({
          VariableDeclarator: (declPath) => {
            if (t.isCallExpression(declPath.node.init) == false) return;
            const init = declPath.node.init;
            const firstArg = init.arguments[0]
            if (t.isIdentifier(firstArg) == false && firstArg != "module") return;
            if (isRequire(init.callee) == false) return;
            if (isImportPkginfo(init.callee) == false) return;
            const refs = init.arguments.slice(1).map(id => id.value);
            const f = finder(state.file.opts.filenameRelative)
            const v = f.next().value
            refs.forEach(d => path.insertBefore(
              t.expressionStatement(
                t.assignmentExpression("=", t.identifier(`module.exports.${d}`), literal(v[d]))
              )
            ))
            declPath.remove()
          }
        });
      }
    }
  };
}
```

これで　簡単な　pkginfo モジュールの呼び出しについては 静的に解決できるようになりました。
では、再度 bundleして テストしてみましょう。

```
$ npx webpack
$ sam local start-api --env-vars env.json
```

先ほどと同じように curlで叩いてみましょう。

```
$ curl -XPOST http://localhost:3000/message -d '{"channel":"bot", "message":"test"}'
{ "message": "Internal server error" }
```

動きません。

AWS SAM Local を起動したコンソールに　次のようなメッセージが出ています。

```
START RequestId: afdd68cb-fc3b-1b03-24f5-a9deec0f0a3b Version: $LATEST
Handler 'postMessage' missing on module 'index'
END RequestId: afdd68cb-fc3b-1b03-24f5-a9deec0f0a3b
REPORT RequestId: afdd68cb-fc3b-1b03-24f5-a9deec0f0a3b  Duration:307.11 ms       Billed Duration: 0 ms   Memory Size: 0 MB       Max Memory Used: 51 MB
```

Handlerがない、と怒られています。

ここまで辿り着いた皆さんならお分かりかもしれません。
webpack の設定が足りません。

libraryTarget を commonjs2 にしておきましょう。(commonjsでもいいです)

```typescript
"use strict"
import * as path from "path"

import * as webpack from "webpack"

const config: webpack.Configuration = {
  devtool: "source-map",
  entry: "./index.ts",
  output: {
    path: path.resolve("./target"),
    filename: "index.js",
    libraryTarget: "commonjs2",
  },
  target: "node",
  resolve: {
    extensions: [".json", ".tsx", ".ts", ".js"]
  },
  plugins: [
    // new webpack.optimize.UglifyJsPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        use: [
          {
            loader: "babel-loader",
          },
        ],
      },
      {
        test: /\.ts?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
}

module.exports = config
```

では、気を取り直して再度 bundle して　AWS SAM Local で動かします。

```
$ npx webpack
$ sam local start-api --env-vars env.json
```

curl でまた叩きます。

```
$ curl -XPOST http://localhost:3000/message -d '{"channel":"bot", "message":"test"}'
message is posted
```

動きました。

<img src="https://cdn-ssl-devio-img.classmethod.jp/wp-content/uploads/2017/12/4ae9e651f5557a153a71a6586e9c3af1.png" alt="" width="364" height="92" class="alignnone size-full wp-image-302893" />

## アプリケーションのデプロイのために s3 バケットを用意しておきます

AWS Lambdaのコードのデプロイのためには
コードを zipで固めて s3 に配置する必要があります。

s3 バケットを用意しておきましょう。
バケット名の制約に引っかかると辛いので、次のコマンドをつかって　bucket の suffix を生成しました。
バケット名の制約で 大文字が使えないので tr で 小文字にしています。

```bash
uuidgen | tr A-Z a-z | pbcopy # クリップボードにコピー
```

生成した uuid をsuffixにして bucketを作っておきます。

```
$ aws s3api create-bucket --bucket lambda-test-uuid-dsdsds-dsdsds-dsajdhas
```

## アプリケーションの package をする

アプリケーションのパッケージを行いましょう。
sam package コマンドを使います。

```
sam package --template-file template.yml --output-template-file lambda-test.yml --s3-bucket lambda-test-uuid-dsdsds-dsdsds-dsajdhas
```

sam package コマンドは aws cloudformation packageの エイリアスです。
（そのため、AWS CLIが入ってないと怒られます。）

`template.yml` をベースに
次のような cloudformation の ymlが生成されます。

```
AWSTemplateFormatVersion: '2010-09-09'
Description: SAM Local test
Parameters:
  SlackToken:
    Description: Enter slack token for bot.
    Type: String
Resources:
  HelloWorld:
    Properties:
      CodeUri: s3://lambda-test-uuid-dsdsds-dsdsds-dsajdhas/<some-identifier>
      Environment:
        Variables:
          SLACK_TOKEN:
            Ref: SlackToken
      Events:
        GetResource:
          Properties:
            Method: post
            Path: /message
          Type: Api
      Handler: index.postMessage
      Runtime: nodejs6.10
    Type: AWS::Serverless::Function
Transform: AWS::Serverless-2016-10-31
```

このファイルを使って
アプリケーションのデプロイをやっていきましょう。

## アプリケーションの deploy をする

次のコマンドで デプロイ可能です。
`--parameter-overrides` で Slackのアクセストークンを渡しています。

```
$ sam deploy --template-file lambda-test.yml --stack-name lambda-test --parameter-overrides "SlackToken=<your-access-token>" --capabilities CAPABILITY_IAM
```

こちらも awscliのエイリアスです。

やっとデプロイできました。

## 実際に API Gateway経由で 動作を確認する

動かしてみます。

```bash
$ curl https://<your-gateway-id>.execute-api.ap-northeast-1.amazonaws.com/Prod/message
{"message":"Missing Authentication Token"}
```

初め、curl で間違えました。上記のようなログが出てきて、見たことのないメッセージにびっくりしました。
設定している APIの情報とあっていない為、次のようなログが出ています。
具体的にはリクエストボディとHTTPメソッドの指定が足りていません。
curl の場合 次のような形で リクエストボディを指定すると POSTになります。

```
$ curl https://<your-gateway-id>.execute-api.ap-northeast-1.amazonaws.com/Prod/message -d '{"channel":"bot", "message":"test"}'
message is posted
```

動きました。

## まとめ

今回は slackに通知するアプリケーションを AWS SAM Local で事前にテストしつつ
webpack で bundleしながら、sam コマンド経由で アプリケーションをデプロイしました。

まだまだ温もり溢れる手作業感はありますが
一通りデプロイまで動かすことができました。

yak を順調に刈りながら アドベントカレンダーの記事ができました。

今回は webpack を使って bundleしました。
webpack を使った理由としては、package.json に記述している devDependencies の モジュールが入るのが避けたかった
と言うところです。
(ローカルの状況によっていくらでも入っちゃいます。)
devDependencies のモジュールが入らないようにするには次のような方法が考えられると思います。

* bundleしない
  * typescript は tsc で target/ 以下に トランスパイル
  * package.json も target/ 以下にコピー
  * target/ 以下で npm i --only=production で dependenciesだけインストール
* bundleする + CodeUri でコードを指定
* 諦める

bundleしない選択肢を取ると npm i をしないといけなくなり、インストールの時間がかかります。
今回作ったアプリケーションでは `6.578s` でした。
bundle する場合は 開発時の依存関係をインストールした状態のまま、そのまま deploy まで持っていけます。
しかし、今回のケースの場合、bundle されたソース類の都合上
いくつかのモジュールが 解決できない状態になっています。

と言うわけで　どっちもどっち感があります。
最近は npm install も早くなったので bundle しなくても気にならないかも。

この記事ではデプロイ面で非常に悩みが溢れる感じになってしまいました。
皆さんはどんな形でデプロイをしているのでしょうか。
コメントやシェアする際に教えていただけると幸いです。

ありがとうございました。

babel プラグインで解決するのは本来あまりよくないので
できる限り避けましょう。

明日の記事は [西村さん](https://dev.classmethod.jp/author/nishimura-yuji/) による Elasticsearch と Lambda を絡めた記事だそうです。

楽しみですね。

それではこの記事はここでお終いです。
ご飯食べてきます。

今回作成したアプリケーションは[こちらのリポジトリ](https://github.com/wreulicke/lambda-sandbox/tree/2f3a02d468957db42177e4d58b6246dd8d8a80dc/sam-local-webpack)に置いてあります。

## 参考

* [API GatewayとLambdaでAPI作成のチュートリアル](https://qiita.com/vankobe/items/ab5bc6487c7e07cb3aba)
* [変換を伴うテンプレートの迅速なデプロイ](http://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/using-cfn-cli-deploy.html)
* [AWS CLI Command Reference (aws/cloudformation/deploy)](http://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy/index.html)
* [独自のサーバーレスアプリケーションを作成する](http://docs.aws.amazon.com/ja_jp/lambda/latest/dg/serverless-deploy-wt.html#serverless-deploy)
* [Serverless Application ModelのCodeUriプロパティとデプロイメントパッケージの関係を理解する](https://dev.classmethod.jp/cloud/aws/understanding-codeuri-property-and-deployment-package-in-serverless-application-model/)