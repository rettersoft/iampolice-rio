import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import AWS from "aws-sdk";
import { InitBody, StartIAMFetchInput, AWSSecretsInput, AWSWorkerEventBody } from './rio'
import AWSHandler from './aws'
const rdk = new RDK();

interface AWSResource {
    arn: string
    accountId: string
    data: any
    resourceType: string
}

interface AttachedManagedPolicy {
    PolicyName: string;
    PolicyArn: string;
}

interface IamUser {
    Path: string;
    UserName: string;
    UserId: string;
    Arn: string;
    CreateDate: string;
    UserPolicyList: any[];
    GroupList: any[];
    AttachedManagedPolicies: AttachedManagedPolicy[];
    Tags: any[];
    mfaDevices: any[];
}

interface AWSPublicState {
    status: "running" | "idle";
    progress?: {
        finished: number
        total: number
        currentAwsAccountId: string
    }
}

interface AWSAccount {
    accountId: string;
    arn: string;
    accountName: string;
    email: string;
    work: {
        status: "not_started" | "running" | "finished"
        errorStr?: string
        workers: {
            AWSIAMWorker: {
                status: "not_started" | "running" | "finished"
            }
        }
    }
}

interface AWSPrivateState {
    email: string
    credentials?: {
        accessKeyId: string
        secretAccessKey: string
    }
    awsResources: AWSResource[]
    iamUsers: any[]
    groups: any[]
    roles: any[]
    policies: any[]
    errors: any[]
    awsAccounts: AWSAccount[]
}



interface AWSData<I = any, O = any> extends Data<I, O, AWSPublicState, AWSPrivateState> {

}

export async function getInstanceId(data: Data<InitBody>): Promise<string> {
    return data.request.body.email
}

export async function authorizer(data: Data): Promise<Response> {
    return { statusCode: 401 };
}

export async function init(data: AWSData<InitBody>): Promise<Data> {
    data.state.private = {
        email: data.request.body.email,
        iamUsers: [],
        awsResources: [],
        awsAccounts: [],
        errors: [],
        groups: [],
        roles: [],
        policies: []
    }
    data.state.public.status = "idle"
    return data
}

export async function getState(data: Data): Promise<Response> {
    return { statusCode: 200, body: data.state };
}

export async function clear(data: AWSData): Promise<Data> {
    data.state.private.iamUsers = []
    data.state.private.awsAccounts = []
    data.state.private.awsResources = []
    data.state.private.errors = []
    data.state.private.groups = []
    data.state.private.roles = []
    data.state.private.policies = []
    data.state.public.status = "idle"

    return data
}

export async function start(data: AWSData): Promise<Data> {

    // data.state.public.status = "fetching_users"

    data.state.private.errors = []
    data.state.private.awsAccounts = []
    data.state.private.iamUsers = []
    data.state.private.awsResources = []

    const credentials = data.state.private.credentials

    // Fetch aws account list
    const awsHandler = new AWSHandler(credentials.accessKeyId, credentials.secretAccessKey)
    try {
        data.state.private.awsAccounts = (await awsHandler.getAllAWSAccountsInOrganization()).map((account: any) => {
            return {
                accountId: account.Id,
                arn: account.Arn,
                accountName: account.Name,
                email: account.Email,
                work: {
                    status: "not_started",
                    workers: {
                        AWSIAMWorker: {
                            status: "not_started"
                        }
                    }
                }
            }
        })

        // Also copy all aws accounts to awsResources
        data.state.private.awsResources = data.state.private.awsAccounts.map((account: AWSAccount) => {
            return {
                arn: account.arn,
                accountId: account.accountId,
                data: account,
                resourceType: "aws:organization:account"
            }
        })
    } catch (err) {
        data.state.private.errors.push(err)
        return data
    }

    data.tasks = [{
        after: 0,
        method: "startNextAccount"
    }]

    return data
}

export async function receiveWorkerEvents(data: AWSData<AWSWorkerEventBody>): Promise<Data> {

    // Find account for this event
    let account = data.state.private.awsAccounts.find(a => a.accountId === data.request.body.accountId)

    // update account status
    account.work.workers[data.context.identity].status = data.request.body.status

    // If this worker has finished add its data to awsResources in private state
    if (data.request.body.status === "finished") {
        const resources:AWSResource[] = data.request.body.data as AWSResource[]
        data.state.private.awsResources = data.state.private.awsResources.concat(resources)
    }

    // Check if all workers are finished in this account
    let allWorkersFinished = true
    for (const worker in account.work.workers) {
        if (account.work.workers[worker].status !== "finished") {
            allWorkersFinished = false
            break
        }
    }

    // If all workers are finished, update account status
    if (allWorkersFinished) {
        account.work.status = "finished"

        // Start next account
        data.tasks = [{
            after: 0,
            method: "startNextAccount"
        }]
    }

    // Remove progress from public state if every account is finished
    if (data.state.private.awsAccounts.every(a => a.work.status === "finished")) {
        delete data.state.public.progress
        // Set status to idle
        data.state.public.status = "idle"
    } else {
        // Update progress in public state
        data.state.public.progress = {
            finished: data.state.private.awsAccounts.filter(a => a.work.status === "finished").length,
            total: data.state.private.awsAccounts.length,
            currentAwsAccountId: data.request.body.accountId
        }
        // Set status to running
        data.state.public.status = "running"
    }

    return data
}



export async function startNextAccount(data: AWSData): Promise<Data> {
    // Find first aws account with not_started status
    let account = data.state.private.awsAccounts.find((account: AWSAccount) => account.work.status === "not_started")
    account.work.status = "running"

    // Assume role in account
    const credentials = data.state.private.credentials
    const awsHandler = new AWSHandler(credentials.accessKeyId, credentials.secretAccessKey)
    try {
        const roleCredentials = await awsHandler.assumeAWSAccount({
            Id: account.accountId,
        }, "OrganizationAccountAccessRole")

        await rdk.getInstance({
            classId: "AWSIAMWorker",
            body: {
                email: data.context.instanceId
            }
        })

        data.tasks = [{
            after: 0,
            method: "start",
            classId: "AWSIAMWorker",
            instanceId: data.context.instanceId,
            payload: {
                accountId: account.accountId,
                accessKeyId: roleCredentials.AccessKeyId,
                secretAccessKey: roleCredentials.SecretAccessKey,
                sessionToken: roleCredentials.SessionToken
            }
        }]
    } catch (err) {
        account.work.status = "finished"
        account.work.errorStr = err.message

        // Start next account
        data.tasks = [{
            after: 0,
            method: "startNextAccount"
        }]
    }



    return data
}

export async function getData(data: AWSData): Promise<Data> {
    data.response = {
        statusCode: 200,
        body: {
            iamUsers: data.state.private.iamUsers,
            awsAccounts: data.state.private.awsAccounts,
            errors: data.state.private.errors,
            groups: data.state.private.groups,
            roles: data.state.private.roles,
            policies: data.state.private.policies
        }
    }
    return data
}

// export async function handleSingleAWSAccount(data: IamData): Promise<Data> {




//     try {

//         const awsAccountId = data.state.private.awsAccounts.findIndex(a => a.Id === data.request.body.Id)
//         data.state.private.awsAccounts[awsAccountId].processed = true

//         const cancelFlag = await rdk.getMemory({
//             key: "cancel"
//         })

//         // Send an event to Account class with current processing AWS Account Id
//         await rdk.methodCall({
//             classId: "Account",
//             instanceId: data.context.instanceId,
//             methodName: "handleEvents",
//             body: {
//                 IAM: {
//                     status: cancelFlag.success ? "cancelled_cleaning_up" : "fetching_users",
//                     awsAccountId: data.request.body.Id,
//                     progress: {
//                         current: data.state.private.awsAccounts.filter(a => a.processed).length,
//                         total: data.state.private.awsAccounts.length,
//                         str: data.state.private.awsAccounts.filter(a => a.processed).length + "/" + data.state.private.awsAccounts.length
//                     }
//                 }
//             }
//         })


//         if (!cancelFlag.success) {

//             const awsHandler = new AWSHandler(data.state.private.accessKeyId, data.state.private.accessKeySecret)

//             console.log("handleSingleAWSAccount", data.request.body)

//             let creds = await awsHandler.assumeAWSAccount(data.request.body)

//             console.log("creds", creds)

//             let {
//                 users,
//                 groups,
//                 roles,
//                 policies
//             } = await awsHandler.getAccountAuthorizationDetails(creds)

//             users = users.map(u => ({
//                 ...u,
//                 AccountId: data.request.body.Id
//             }))


//             data.state.private.awsAccounts[awsAccountId].userDetails = {
//                 count: users.length,
//             }

//             data.state.private.iamUsers = data.state.private.iamUsers.concat(users)
//             data.state.private.groups = data.state.private.groups.concat(groups)
//             data.state.private.roles = data.state.private.roles.concat(roles)
//             data.state.private.policies = data.state.private.policies.concat(policies)

//         }

//     } catch (err) {
//         data.state.private.errors = data.state.private.errors.concat(err)
//         console.log("err", err)
//     }

//     // Find out if every account is processed
//     const allAccountsProcessed = data.state.private.awsAccounts.every(a => a.processed)
//     // If all accounts are processed, send event to Account class
//     if (allAccountsProcessed) {
//         data.state.public.status = "idle"
//         data.state.private.accessKeyId = undefined
//         data.state.private.accessKeySecret = undefined
//         await rdk.methodCall({
//             classId: "Account",
//             instanceId: data.context.instanceId,
//             methodName: "handleEvents",
//             body: {
//                 IAM: {
//                     status: "idle"
//                 }
//             }
//         })
//         await rdk.deleteMemory({
//             key: "cancel"
//         })
//     }

//     // console.log("data.state.private.iamUsers", data.state.private.iamUsers)

//     return data
// }

// export async function fetchAwsAccount(data: IamData): Promise<Data> {
//     return data
// }

export async function setCredentials(data: AWSData<AWSSecretsInput>): Promise<Data> {
    data.state.private.credentials = {
        accessKeyId: data.request.body.accessKeyId,
        secretAccessKey: data.request.body.secretAccessKey
    }
    data.response = {
        statusCode: 200,
        body: "OK"
    }
    return data
}