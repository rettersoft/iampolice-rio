import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import { InitBody, VerifyOtpInput, AWSSecretsInput } from './rio'

const rdk = new RDK();

interface AccountPublicState {
    IAM: {
        status: "idle" | "fetching_users"
    }
}

interface AccountPrivateState {
    email: string
    accountTier: "free" | "pro"
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
        accountTier: "free"
    }
    data.state.public = {
        IAM: {
            status: "idle"
        }
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


// changeAccountTier implementation
export async function changeAccountTier(data: AccountData): Promise<Data> {
    data.state.private.accountTier = data.request.body.accountTier
    return data
}

export async function reset(data: AccountData): Promise<Data> {
    data.state.public.IAM = {
        status: "idle"
    }
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
