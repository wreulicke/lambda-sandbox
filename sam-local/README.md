# AWS SAM Local と Localstack を使って ローカルでAWS Lambdaのコードを動かす。

今回動かすアプリケーションはAPI Gateway経由で起動されたAWS Lambdaから
テストデータをS3に書き込むだけのアプリケーションを全てローカルで動かしてみたいと思います。
アプリケーションのコードはTypeScriptを使って記述します。

## Testing Environment

* MacOS Sierra 10.12.6
* Docker (17.09.0-ce)
* Node (v8.8.0) and NPM (5.5.1)
* AWS SAM Local 0.2.2
* Lambda Runtime は nodejs6.10
* TypeScript Version 2.6.1
* AWS CLI aws-cli/1.11.96 Python/2.7.10 Darwin/16.7.0 botocore/1.5.59


```js
.
─── docker-compose.yml
├── index.ts
├── index.js // トランスパイル後のコード
├── env.json
├── package.json
├── template.yml // SAMを用いたCloudformationテンプレート
└── tsconfig.json
```

## AWS SAM Localのインストール

DockerとNodeはすでに入っていることを前提にします。

まずはAWS SAM Localをグローバルにインストールします。

```sh
$ npm i aws-sam-local -g
```

これでインストールは完了です。
なお、検証用に使ったMacOSでは、ローカルにインストールすると
go-npmの問題でインストール時に失敗しました。

## SAM を用いた Cloudformation テンプレートを記述する

以下のようなCloudformation テンプレートを用意しました。

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: SAM Local test
Resources:
  HelloWorld:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.hello
      Runtime: nodejs6.10
      Environment:
        Variables:
          NODE_ENV: !Ref NODE_ENV
      Events:
        GetResource:
          Type: Api
          Properties:
            Path: /resource/{resourceId}
            Method: put
```

## 実行前に準備

### localstackでS3を用意する

AWS LambdaからアクセスするS3を用意するためにlocalstackを使います。
localstackのセットアップの為には、docker-composeを使います。
今回用意したのは以下の `docker-compose.yml` ファイルです。

```yaml
version: '3'
services:
  localstack:
    image: localstack/localstack
    ports: 
      - 4567-4578:4567-4578
      - 8080:8080
```

最低限のlocalstackの設定を記述しています。

まずはlocalstackを起動してみます。ここではバックグラウンドで起動しておきます。
docker psでlocalstackが起動していることが確認できます。

```sh
$ docker-compose up -d
$ docker ps
CONTAINER ID        IMAGE                   COMMAND                  CREATED             STATUS              PORTS                         NAMES
1d66aa4d566b        localstack/localstack   "/usr/bin/supervis..."   3 minutes ago       Up 3 minutes        0.0.0.0:4567-4578->4567-4578/tcp, 0.0.0.0:8080->8080/tcp, 4579-4583/tcp   samlocal_localstack_1
```

### 書き込み先のS3のバケットを用意する

事前準備としてAWS CLIでlocalstackのS3にバケットを作っておきます。
ここでは `test-bucket` という名前にしておきました。

```sh
$ aws --endpoint-url=http://localhost:4572 s3api create-bucket --bucket test-bucket # test-bucketというバケットを作る
```

### SAM Local上 の AWS Lambdaで環境変数を設定する

SAM Localの実行環境上の AWS Lambdaで環境変数を与えるためにJSONを用意しておきます。
今回は `HelloWorld` という名前でAWS Lambdaの関数を用意したので
そのキーの下に設定したい環境変数を記述しています。
ここでは、`NODE_ENV` に値を設定しています。

```json
{
  "HelloWorld": {
    "NODE_ENV": "local"
  }
}
```

今回作ったのは、SAM Local の start-api サブコマンドに--env-varsに渡す設定ファイルです。
以下のような形で環境変数を与えることが可能です。

```sh
$ sam local start-api --env-vars env.json # --env-varsで環境変数の設定ができる
```

## LocalstackとSAM Localの連携を行って実際にローカルでLambdaを動かしてみる

やっとこさ準備が終わりました。
ここで、SAM Localを使ってAWS Lambdaを実行してみます。

今回は以下のTypeScriptをAWS Lambdaで実行します（実際にはトランスパイルしたJSコードです）。

```typescript
import Lambda from "aws-lambda"
import * as AWS from "aws-sdk"

const config: AWS.S3.Types.ClientConfiguration = {
  endpoint: (process.env.NODE_ENV === "local"? "http://localstack:4572": undefined),
  s3ForcePathStyle: process.env.NODE_ENV === "local",
}
const s3 = new AWS.S3(config)

export async function hello(event: Lambda.APIGatewayEvent, context: Lambda.Context, callback: Lambda.ProxyCallback) {
  const resourceId = event.pathParameters!.resourceId
  try {
    await s3.putObject({
      Bucket: "test-bucket",
      Key: resourceId,
      Body: "hogehoge",
    }).promise()
    callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        resourceId,
        contextRequestId: context.awsRequestId
      }),
      headers:{
        "Content-Type": "application/json"
      }
    })
  } catch (e) {
    callback(e)
  }
}
```

さて、ここからSAM Localを起動するのですが・・・
その前に一つだけ確認しておく内容があります。

それは、AWS Lambdaのランタイムが実行される、docker-network です。
SAM Localでは、実行される、docker-networkを指定できます。
この指定を行うことで、Dockerコンテナ上に事前に用意したインフラを使うことが可能です。

次のコマンドで確認します。

```sh
$ docker network ls
NETWORK ID          NAME                        DRIVER              SCOPE
dfc8bc652af3        lambdasandbox_default       bridge              local
39fd5e338bfd        samlocal_default            bridge              local
```

ここでのNAMEは、docker-composeで起動した場合、`フォルダ名_default` みたいな形になるようです。（なぜかハイフン抜けてる）
今回起動したのは `sam-local` フォルダだったので `samlocal_default` になりました。
ここに出力された NETWORK IDである、`39fd5e338bfd` をメモしておきます。

`docker-compose.yml` に networkの設定を追加すると別の名前になるようですが
ここでは説明を省きます。

ちなみに inspect サブコマンドを使うとどんなコンテナが起動しているか確認できます。

```
$ docker network inspect 39fd5e338bfd
[ 
    {
        "Name": "samlocal_default",
        "Id": "39fd5e338bfd81823fd35f1f75e471281c8a76a061ad42411f03393d61c1460c",
        "Containers": {
            "1d66aa4d566b0b122e006668c1ee3d947caa89b8ae8f5f2b27b15f9f7636f5f3": {
                "Name": "samlocal_localstack_1",
                "EndpointID": "679c2a0e2f9fadeb7457710dc64c9ca98d7964246adfff1ff51af67533c06afc",
                ...省略
            }
        },
        ... 省略
    }
]
```

では、お待ちかねのSAM Localでlocalstackと連携してみましょう。

次のコマンドで起動してみます。
AWS Lambdaが起動するnetworkと環境変数のオプションを追加しています。

```
$ sam local start-api --docker-network 39fd5e338bfd --env-vars env.json
```

これで、ローカルでAWS Lambdaを実行することができます。長かった・・・。
（まだ実行してません。）

それでは実行してみましょう。

```sh
$ curl -XPUT http://localhost:3000/resource/test
{"resourceId":"test","contextRequestId":"86b562c1-089f-141d-55c4-91a27a0f357e"}
```

今回用意したのは簡単なAPIで手抜きもいいところですが・・・
S3にオブジェクトが書き込まれているはずです。


```sh
$ aws --endpoint-url=http://localhost:4572 s3api get-object --bucket test-bucket --key test object.txt #取り出したobjectを取得してみる
{
    "ContentType": "application/octet-stream",
    "LastModified": "Tue, 21 Nov 2017 08:02:33 GMT",
    "ContentLength": 8,
    "ETag": "\"329435e5e66be809a656af105f42401e\"",
    "Metadata": {}
}

$ cat object.txt #取り出したobjectを表示してみる
HelloWorld
```

ちゃんと書き込みがされています。
動いてますね。

## まとめ

今回はAWS SAM LocalとLocalstackを使って、全てローカルでAWS Lambdaの関数を動かすことができました！
AWS SAM Localにはローカルで実行する以外にも、様々な機能が存在します。
色々試してみたいところですね。