import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import { InitBody, VerifyOtpInput, AWSSecretsInput } from './rio'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2022-08-01'
})



const rdk = new RDK();

export async function authorizer(data: Data): Promise<Response> {

    return { statusCode: 401 };
}

export async function getInstanceId(data: Data<InitBody>): Promise<string> {
    return "default"
}

export async function init(data: Data): Promise<Data> {

    return data
}

export async function getState(data: Data): Promise<Response> {
    return { statusCode: 200, body: data.state };
}





export async function webhookHandler(data: Data): Promise<Data> {

    const sig = data.request.headers['stripe-signature'];

    let event = data.request.body;

    console.log("event", JSON.stringify(event))

    console.log("event type", event.type)




    // try {
    //     event = stripe.webhooks.constructEvent(JSON.stringify(request.body), sig, endpointSecret);
    //     console.log("event", JSON.stringify(event, null, 2))
    // } catch (err) {
    //     console.log("err1", err)
    //     // return {
    //     //     statusCode: 400,
    //     //     body: `Webhook Error: ${err.message}`,
    //     // }
    // }



    try {
        // Handle the events
        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.deleted':
            case 'customer.subscription.updated':
                const eventData = event.data.object
                console.log("eventData", JSON.stringify(eventData))
                await rdk.methodCall({
                    classId: "Account",
                    lookupKey: {
                        name: "stripeCustomerId", value: eventData.customer
                    },
                    methodName: "updateStripeSubscription",
                    body: {
                        eventType: event.type,
                        subscription: eventData
                    }
                })
                break

            // ... handle other event types
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
    } catch (err) {
        console.log("err2", err)
    }

    data.response = {
        statusCode: 200
    }

    return data
}
