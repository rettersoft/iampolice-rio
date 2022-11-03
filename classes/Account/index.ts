import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import { InitBody, VerifyOtpInput, AWSSecretsInput, ChangePlanInput, CancelSubscriptionInput } from './rio'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2022-08-01'
})

const YOUR_DOMAIN = 'www.iampolice.com'

const rdk = new RDK();



interface AccountPublicState {
    IAM: {
        status: "idle" | "fetching_users"
    }
    accountTier: AccountTier
    subscriptionSummary?: {
        interval: string
        amount_decimal: string
        created: number
        currency: string
        current_period_start: number
        current_period_end: number
        interval_count: number
        curentStripePrice: StripePrice
    }
}

enum AccountTier {
    FREE = "free",
    STARTUP = "startup",
    PRO = "pro"
}

enum StripePrice {
    PRO_MONTHLY = "pro_monthly",
    PRO_ANNUALLY = "pro_annually",
    STARTUP_MONTHLY = "startup_monthly",
    STARTUP_ANNUALLY = "startup_annually"
}

interface SubscriptionPlan {
    price_id?: StripePrice
    name: string
    description: string
    priceStr: string
    isFree: boolean
    interval?: "month" | "year"
}

const subsctionPlans : SubscriptionPlan[] = [
    {
        name: "Free",
        description: "Free plan",
        priceStr: "Free",
        isFree: true
    },
    {
        price_id: StripePrice.PRO_MONTHLY,
        name: "Pro Monthly",
        description: "Pro Monthly",
        priceStr: "$49/month",
        isFree: false,
        interval: "month"
    },
    {
        price_id: StripePrice.PRO_ANNUALLY,
        name: "Pro Annually",
        description: "Pro Annually",
        priceStr: "$499/year",
        isFree: false,
        interval: "year"
    },
    {
        price_id: StripePrice.STARTUP_MONTHLY,
        name: "Startup Monthly",
        description: "Startup Monthly",
        priceStr: "$19/month",
        isFree: false,
        interval: "month"
    },
    {
        price_id: StripePrice.STARTUP_ANNUALLY,
        name: "Startup Annually",
        description: "Startup Annually",
        priceStr: "$199/year",
        isFree: false,
        interval: "year"
    }
]

interface AccountPrivateState {
    email: string
    accountTier: AccountTier
    subscription?: any
    stripe?: {
        customerId: string
        subscription?: any
        curentStripePrice?: StripePrice
        cancelReason?: string
    }
    otp?: {
        code: string
        createdAt: string
    }
}



interface AccountData<I = any, O = any> extends Data<I, O, AccountPublicState, AccountPrivateState> {

}

export async function authorizer(data: Data): Promise<Response> {

    return { statusCode: 401 };
}

export async function getInstanceId(data: Data<InitBody>): Promise<string> {
    return data.request.body.email
}

export async function init(data: AccountData): Promise<Data> {
    data.state.private = {
        email: data.request.body.email,
        accountTier: AccountTier.FREE
    }
    data.state.public = {
        IAM: {
            status: "idle"
        },
        accountTier: AccountTier.FREE
    }
    await rdk.setLookUpKey({
        key: {
            name: "email", value: data.request.body.email
        }
    })
    return data
}

export async function getState(data: Data): Promise<Response> {
    return { statusCode: 200, body: data.state };
}

export async function sendOtp(data: AccountData): Promise<Data> {

    // Create a random 6 digit code
    // const code = Math.floor(100000 + Math.random() * 900000).toString()
    const code = '141414'
    // Save the code in the state
    data.state.private.otp = {
        code,
        createdAt: new Date().toISOString()
    }
    return data
}

export async function verifyOtp(data: AccountData<VerifyOtpInput>): Promise<Data> {

    // Check if the code is correct
    if (data.state.private.otp?.code !== data.request.body.code) {
        data.response = { statusCode: 401, body: { message: 'Invalid code' } }
        return data
    }

    // Check if the code is expired
    const createdAt = new Date(data.state.private.otp.createdAt)
    const now = new Date()
    const diff = now.getTime() - createdAt.getTime()
    const minutes = Math.floor(diff / 1000 / 60)
    if (minutes > 5) {
        data.response = { statusCode: 401, body: { message: 'Code expired' } }
        return data
    }

    // If the code is correct and not expired, then delete the code from the state
    delete data.state.private.otp

    // Generate a custom token 
    const token = await rdk.generateCustomToken({
        identity: "enduser",
        userId: data.state.private.email
    })

    data.response = {
        statusCode: 200,
        body: token
    }

    return data
}

export async function reset(data: AccountData): Promise<Data> {
    data.state.public.IAM = {
        status: "idle"
    }
    delete data.state.private.stripe
    return data
}


// export async function cancelFetchUsers(data: AccountData): Promise<Data> {
//     await rdk.setMemory({
//         key: "cancel", value: true
//     })
//     return data
// }

// export async function fetchUsers(data: AccountData): Promise<Data> {

//     if (data.state.public.IAM.status !== "idle") {
//         data.response = { statusCode: 400, body: { message: "Fetching users in progress" } }
//         return data
//     }

//     if (data.state.private.aws === undefined || data.state.private.aws.accessKeyId === undefined || data.state.private.aws.accessKeySecret === undefined) {
//         data.response = { statusCode: 400, body: { message: "No AWS credentials" } }
//         return data
//     }

//     await rdk.getInstance({
//         classId: "IAM",
//         body: {
//             email: data.state.private.email
//         }
//     })

//     data.response = {
//         statusCode: 200,
//         body: "OK",
//     };

//     data.tasks = [{
//         classId: "IAM",
//         instanceId: data.context.instanceId,
//         method: "fetchUsers"
//         after: 0,
//     }]

//     return data;
// }

export async function handleEvents(data: AccountData): Promise<Data> {

    data.state.public = {
        ...data.state.public,
        ...data.request.body
    }

    return data
}

const createStripeUser = async (email: string) => {
    const customer = await stripe.customers.create({
        email
    })
    return customer.id
}

// changeStripeSubscriptionPlan
export async function changeStripeSubscriptionPlan(data: AccountData<ChangePlanInput>): Promise<Data> {

    if (data.state.private.accountTier === AccountTier.FREE) {
        data.response = {
            statusCode: 400,
            body: { message: "You need to upgrade to a paid plan first" }
        }
        return data
    }

    if (data.state.private.stripe === undefined) {
        data.response = {
            statusCode: 400,
            body: { message: "No stripe customer id" }
        }
    }

    const { price_id } = data.request.body
    const prices = await stripe.prices.search(
        { query: `metadata['price_id']: "${price_id}"` }
    )

    // Check if current price_id is the same as the new one
    
    if (data.state.public.subscriptionSummary.curentStripePrice.toString() === price_id) {
        data.response = {
            statusCode: 400,
            body: { message: "You are already subscribed to this plan" }
        }
        return data
    }

    const subscription = await stripe.subscriptions.retrieve(data.state.private.stripe.subscription.id);
    await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{
            id: subscription.items.data[0].id,
            price: prices.data[0].id,
        }]
    });

    return data
}

export async function createStripeCheckoutSession(data: AccountData<ChangePlanInput>): Promise<Data> {

    // Check if currently a subscription is active, if so return error code
    if (data.state.private.accountTier !== AccountTier.FREE) {
        data.response = { statusCode: 400, body: { message: "Already subscribed. You can change your plan." } }
        return data
    }

    let stripeCustomerId = undefined

    // Create customer if not exists
    try {

        // Check stripe data. If no stripe user is created before, create one
        stripeCustomerId = data.state.private.stripe?.customerId
        if (!stripeCustomerId) {
            // Create stripe user
            stripeCustomerId = await createStripeUser(data.state.private.email)
            data.state.private.stripe = {
                customerId: stripeCustomerId
            }
            await rdk.setLookUpKey({
                key: {
                    name: "stripeCustomerId",
                    value: stripeCustomerId
                }
            })
        }

        console.log("stripeCustomerId", stripeCustomerId)
    } catch (err) {
        console.log("customer create err", err)
    }

    const { price_id } = data.request.body

    console.log("price_id", price_id)

    const prices = await stripe.prices.search(
        { query: `metadata['price_id']: "${price_id}"` }
    )

    console.log("prices", prices)

    const sessionCreateParams = {
        billing_address_collection: 'auto',
        // customer_email: data.context.userId,
        client_reference_id: data.context.userId,
        customer: stripeCustomerId,
        line_items: [
            {
                price: prices.data[0].id,
                // For metered billing, do not pass quantity
                quantity: 1,
            },
        ],
        mode: 'subscription',
        success_url: `https://${YOUR_DOMAIN}/console/settings?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `https://${YOUR_DOMAIN}/console/settings?canceled=true`,
    }

    console.log("sessionCreateParams", sessionCreateParams)

    const session = await stripe.checkout.sessions.create({
        billing_address_collection: 'auto',
        // customer_email: data.context.userId,
        client_reference_id: data.context.userId,
        customer: stripeCustomerId,
        line_items: [
            {
                price: prices.data[0].id,
                // For metered billing, do not pass quantity
                quantity: 1,
            },
        ],
        mode: 'subscription',
        success_url: `https://${YOUR_DOMAIN}/console/settings?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `https://${YOUR_DOMAIN}/console/settings?canceled=true`,
    });

    console.log("session", session)

    if (!session) {
        data.response = {
            statusCode: 500,
            body: {
                message: "Unable to create checkout session"
            }
        }
    } else {
        data.response = {
            statusCode: 200,
            body: {
                sessionId: session.id,
                sessionUrl: session.url
            }
        }
    }



    return data
}


// updateStripeSubscription
export async function updateStripeSubscription(data: AccountData): Promise<Data> {

    console.log("updateStripeSubscription")

    const { eventType, subscription } = data.request.body
    data.state.private.stripe.subscription = subscription

    console.log("eventType", eventType)
    console.log("subscription", subscription)

    switch (eventType) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {

            const { plan } = subscription

            let accountTier = AccountTier.FREE

            if (plan.metadata.price_id === StripePrice.PRO_MONTHLY
                || plan.metadata.price_id === StripePrice.PRO_ANNUALLY) {
                accountTier = AccountTier.PRO
            } else if (plan.metadata.price_id === StripePrice.STARTUP_MONTHLY
                || plan.metadata.price_id === StripePrice.STARTUP_ANNUALLY) {
                accountTier = AccountTier.STARTUP
            }

            data.state.private.accountTier = accountTier
            data.state.private.stripe.curentStripePrice = plan.metadata.price_id
            data.state.public.accountTier = accountTier
            data.state.public.subscriptionSummary = {
                amount_decimal: plan.amount_decimal,
                currency: plan.currency,
                created: plan.created,
                interval: plan.interval,
                interval_count: plan.interval_count,
                current_period_start: subscription.current_period_start,
                current_period_end: subscription.current_period_end,
                curentStripePrice: plan.metadata.price_id
            }

            break
        }
        case "customer.subscription.deleted": {

            data.state.private.accountTier = AccountTier.FREE
            data.state.public.accountTier = AccountTier.FREE
            delete data.state.public.subscriptionSummary

            break
        }
    }

    return data
}


// cancelStripeSubscription
export async function cancelStripeSubscription(data: AccountData<CancelSubscriptionInput>): Promise<Data> {

    const subscriptionId = data.state.private.stripe?.subscription.id

    if (!subscriptionId) {
        data.response = { statusCode: 400, body: { message: "No subscription found." } }
        return data
    }

    const deleted = await stripe.subscriptions.del(subscriptionId, {
        invoice_now: true,
    })
    
    if (deleted) {
        
        data.state.private.stripe.cancelReason = data.request.body.reason
        
        data.response = {
            statusCode: 200,
            body: {
                message: "Subscription canceled"
            }
        }
    } else {
        data.response = {
            statusCode: 500,
            body: {
                message: "Unable to cancel subscription"
            }
        }
    }

    return data
}

// getSubscriptionPlans

export async function getSubscriptionPlans(data: AccountData): Promise<Data> {
    data.response = {
        statusCode: 200,
        body: subsctionPlans,
        headers: {
            // Cache response for 5 minutes
            "Cache-Control": "public, max-age=300, s-maxage=600"
        }
    }
    return data
}

// A method returning account tier
export async function getAccountTier(data: AccountData): Promise<Data> {
    data.response = {
        statusCode: 200,
        body: {
            accountTier: data.state.public.accountTier
        }
    }
    return data
}
