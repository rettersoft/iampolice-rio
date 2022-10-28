import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import AWS from "aws-sdk";
import { InitBody, StartIAMFetchInput, AWSSecretsInput, AWSWorkerEventBody, HandleAWSActionInput } from './rio'
import AWSHandler from './aws'
import resourceTypes from './resourceTypes'

const rdk = new RDK();

const queryExamples = [
    {
        "description": "Find all IAM users without MFA enabled",
        "query": "$[resourceType = 'AWS::IAM::User' and $count(config.mfaDevices) = 0]"
    },
    {
        "description": "Find all IAM users with MFA enabled",
        "query": "$[resourceType = 'AWS::IAM::User' and $count(config.mfaDevices) > 0]"
    },
    {
        "description": "Find all IAM users with 'mike' in their names",
        "query": "$[resourceType = 'AWS::IAM::User' and $contains(config.UserName, 'mike')]"
    },
    {
        "description": "Find all IAM users with AdministratorAccess policy attached and no MFA devices",
        "query": `$[resourceType = 'AWS::IAM::User' 
            and $count(config.mfaDevices) = 0 
            and config.AttachedManagedPolicies.PolicyName = 'AdministratorAccess']`
    }
]

interface AWSResource {
    arn: string
    label: string
    accountId: string
    config: any
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
    fetchCancellation: "requested" | "none"
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
        policies: [],
        fetchCancellation: "none"
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
    data.state.private.fetchCancellation = "none"

    return data
}

export async function handleAction(data: AWSData<HandleAWSActionInput>): Promise<Data> {
    data.response = { statusCode: 200, body: { message: "not implemented yet" } }
    return data
}
export async function cancelFetch(data: AWSData): Promise<Data> {
    data.state.private.fetchCancellation = "requested"
    return data
}

export async function start(data: AWSData): Promise<Data> {

    // Reject if already running
    if (data.state.public.status === "running") {
        data.response = { statusCode: 400, body: { message: "Already running" } }
        return data
    }

    data.state.public.status = "running"

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
            let a = { ...account }
            delete a.work
            return {
                arn: account.arn,
                label: account.email,
                accountId: account.accountId,
                config: a,
                resourceType: "AWS::Organizations::Account"
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

    // if cancellation is requested, stop processing
    if (data.state.private.fetchCancellation === "requested") {
        data.state.public.status = "idle"
        delete data.state.public.progress
        data.state.private.fetchCancellation = "none"
        return data
    }

    // Discard events if not running
    if (data.state.public.status !== "running") {
        return data
    }

    // Find account for this event
    let account = data.state.private.awsAccounts.find(a => a.accountId === data.request.body.accountId)

    // update account status
    account.work.workers[data.context.identity].status = data.request.body.status

    // If this worker has finished add its data to awsResources in private state
    if (data.request.body.status === "finished") {
        const resources: AWSResource[] = data.request.body.data as AWSResource[]
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

    // if cancellation is requested, stop processing
    if (data.state.private.fetchCancellation === "requested") {
        data.state.public.status = "idle"
        delete data.state.public.progress
        data.state.private.fetchCancellation = "none"
        return data
    }

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



export async function getSettings(data: AWSData): Promise<Data> {

    // Create masked strings of credentials in private state
    const credentials = data.state.private.credentials
    if (credentials) {
        data.response = {
            statusCode: 200,
            body: {
                credentials: {
                    accessKeyId: credentials.accessKeyId.substring(0, 4) + "****" + credentials.accessKeyId.substring(credentials.accessKeyId.length - 4),
                    secretAccessKey: credentials.secretAccessKey.substring(0, 4) + "****" + credentials.secretAccessKey.substring(credentials.secretAccessKey.length - 4)
                }
            }
        }
    }

    return data
}

export async function getResources(data: AWSData): Promise<Data> {
    data.response = {
        statusCode: 200,
        body: {
            resourceTypes,
            queryExamples,
            "resources": data.state.private.awsResources
        }
    }
    return data
}

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