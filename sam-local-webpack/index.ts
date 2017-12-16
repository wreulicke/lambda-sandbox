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