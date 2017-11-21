import Lambda from "aws-lambda"
import * as AWS from "aws-sdk"

const config: AWS.S3.Types.ClientConfiguration = {
  endpoint: (process.env.NODE_ENV === "local"? "http://localstack:4572": undefined),
  s3ForcePathStyle: process.env.NODE_ENV === "local",
}
const s3 = new AWS.S3(config)
console.log(s3.endpoint)

export async function hello(event: Lambda.APIGatewayEvent, context: Lambda.Context, callback: Lambda.ProxyCallback) {
  const resourceId = event.pathParameters!.resourceId
  try {
    await s3.putObject({
      Bucket: "test-bucket",
      Key: resourceId,
      Body: "HelloWorld",
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