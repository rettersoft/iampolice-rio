import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import AWS from "aws-sdk";
import {
    InitBody, StartIAMFetchInput, AWSSecretsInput, AWSWorkerEventBody,
    HandleAWSActionInput, DeleteUserInput
} from './rio'
import AWSHandler from './aws'
import resourceTypes from './resourceTypes'

const roleName = "OrganizationAccountAccessRole"

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
            and config.AttachedManagedPolicies[PolicyName = "AdministratorAccess"]]`
    }
]

interface AWSResource {
    arn: string
    label: string
    accountId: string
    accountEmail: string
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

interface NumberOfAccounts {
    total: number
    allowed: number
}

interface AWSPublicState {
    status: "running" | "idle";
    finalStatement: string;
    maskedCredentials?: {
        accessKeyId: string;
        secretAccessKey: string;
    },
    progress?: {
        finished: number
        total: number
        currentAwsAccountId: string
    }
    numberOfAWSAccounts?: NumberOfAccounts
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

interface AWSError {
    accountId: string
    email?: string
    message: string
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
    errors: AWSError[]
    awsAccounts: AWSAccount[]
    numberOfAWSAccounts?: NumberOfAccounts
}



interface AWSData<I = any, O = any> extends Data<I, O, AWSPublicState, AWSPrivateState> {

}

export async function getInstanceId(data: Data<InitBody>): Promise<string> {
    return data.request.body.email
}

export async function authorizer(data: Data): Promise<Response> {
    return { statusCode: 200 };
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
    data.state.public = {
        status: "idle",
        finalStatement: ""
    }
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
    data.state.public.finalStatement = "Not started."
    data.state.private.fetchCancellation = "none"

    return data
}

export async function cancelFetch(data: AWSData): Promise<Data> {
    data.state.private.fetchCancellation = "requested"
    return data
}

// A function to find max number of accounts that can be fetched according to account tier
function getMaxAccountNumberByAccountTier(accountTier: string): number {
    switch (accountTier) {
        case "pro":
            return -1 // unlimited
        case "startup":
            return 20
        default:
            return 3
    }

}

export async function start(data: AWSData): Promise<Data> {

    console.log("data.context.methodName", data.context.methodName)

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

    // Get account tier. This specifies the number of accounts we can fetch
    let getAccountTierResponse = await rdk.methodCall({
        classId: "Account",
        instanceId: data.context.userId,
        methodName: "getAccountTier"
    })

    let numberOfAccountsToFetch = 0
    if (getAccountTierResponse.statusCode === 200) {
        numberOfAccountsToFetch = getMaxAccountNumberByAccountTier(getAccountTierResponse.body.accountTier)
    }

    // Fetch aws account list
    const awsHandler = new AWSHandler(credentials.accessKeyId, credentials.secretAccessKey)
    try {

        const accounts = (await awsHandler.getAllAWSAccountsInOrganization())

        if (numberOfAccountsToFetch === -1) {
            numberOfAccountsToFetch = accounts.length
        }

        const numbers = {
            total: accounts.length,
            allowed: numberOfAccountsToFetch
        }
        data.state.private.numberOfAWSAccounts = numbers
        data.state.public.numberOfAWSAccounts = numbers
        data.state.private.awsAccounts = accounts
            .slice(0, numberOfAccountsToFetch)
            .map((account: any) => {
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
                accountEmail: account.email,
                config: a,
                resourceType: "AWS::Organizations::Account"
            }
        })
    } catch (err) {

        console.log("err", err)

        data.state.private.errors.push({
            accountId: "root",
            message: err.message
        })

        return data
    }

    data.tasks = [{
        after: 0,
        method: "startNextAccount"
    }]

    return data
}

export async function startNextAccount(data: AWSData): Promise<Data> {

    console.log("data.context.methodName", data.context.methodName)

    // if cancellation is requested, stop processing
    if (data.state.private.fetchCancellation === "requested") {
        data.state.public.status = "idle"
        delete data.state.public.progress
        data.state.private.fetchCancellation = "none"
        return data
    }

    // Find first aws account with not_started status
    let account = data.state.private.awsAccounts.find((account: AWSAccount) => account.work.status === "not_started")

    if (!account) {
        return data
    }

    account.work.status = "running"

    // Assume role in account
    const credentials = data.state.private.credentials
    const awsHandler = new AWSHandler(credentials.accessKeyId, credentials.secretAccessKey)
    try {
        const roleCredentials = await awsHandler.assumeAWSAccount({
            Id: account.accountId,
        }, roleName)

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

export async function receiveWorkerEvents(data: AWSData<AWSWorkerEventBody>): Promise<Data> {

    console.log("data.context.methodName", data.context.methodName)

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
        let resources: AWSResource[] = data.request.body.data as AWSResource[]
        // Map resources to add account email address
        resources = resources.map((resource: AWSResource) => {
            resource.accountEmail = account.email
            return resource
        })

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

        data.state.public.finalStatement = `Processed ${data.state.public.progress.total} AWS accounts. Failed to fetch ${data.state.private.awsAccounts.filter(a => a.work.errorStr).length} accounts.`

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

        data.state.public.finalStatement = `Scanning ${data.state.public.progress.finished} of ${data.state.public.progress.total} AWS accounts. ${data.state.private.awsAccounts.filter(a => a.work.errorStr).length} accounts failed so far.`

        // Set status to running
        data.state.public.status = "running"
    }

    return data
}

export async function handleAction(data: AWSData<HandleAWSActionInput>): Promise<Data> {
    const { action, arn, config } = data.request.body

    const accountId = arn.split(":")[4]

    // Assume AWS account
    const credentials = data.state.private.credentials
    const awsHandler = new AWSHandler(credentials.accessKeyId, credentials.secretAccessKey)
    const roleCredentials = await awsHandler.assumeAWSAccount({
        Id: accountId,
    }, roleName)

    switch (action) {
        case "deleteIAMUser": {

            // Send a message to the worker to delete the user
            const deleteInput: DeleteUserInput = {
                accessKeyId: roleCredentials.AccessKeyId,
                secretAccessKey: roleCredentials.SecretAccessKey,
                sessionToken: roleCredentials.SessionToken,
                accountId,
                userName: config.UserName,
            }
            let AWSIAMWorker_response = await rdk.methodCall({
                classId: "AWSIAMWorker",
                instanceId: data.context.instanceId,
                methodName: "deleteIAMUser",
                body: deleteInput
            })

            // Remove the user from the state
            data.state.private.iamUsers = data.state.private.iamUsers.filter((user: IamUser) => user.Arn !== arn)

            // Send response to the client
            data.response = {
                statusCode: 200,
                body: {
                    message: AWSIAMWorker_response.body.message
                }
            }
            return data
        }
        case "deleteUnusedAccessKeysForUser": {
            // Send a message to the worker to delete a users unused access keys
            const deleteInput: DeleteUserInput = {
                accessKeyId: roleCredentials.AccessKeyId,
                secretAccessKey: roleCredentials.SecretAccessKey,
                sessionToken: roleCredentials.SessionToken,
                accountId,
                userName: config.UserName,
            }
            let AWSIAMWorker_response = await rdk.methodCall({
                classId: "AWSIAMWorker",
                instanceId: data.context.instanceId,
                methodName: "deleteUnusedAccessKeysForUser",
                body: deleteInput
            })
            // Send response to the client
            data.response = {
                statusCode: 200,
                body: {
                    message: AWSIAMWorker_response.body.message
                }
            }
            return data
        }

    }

    data.response = { statusCode: 200, body: { message: "not implemented yet" } }
    return data
}

// A function to mask input string
function maskString(str: string): string {
    return str.substring(0, 4) + "****" + str.substring(str.length - 4)
}

export async function getSettings(data: AWSData): Promise<Data> {

    // Create masked strings of credentials in private state
    const credentials = data.state.private.credentials
    if (credentials) {
        data.response = {
            statusCode: 200,
            body: {
                credentials: {
                    accessKeyId: maskString(credentials.accessKeyId),
                    secretAccessKey: maskString(credentials.secretAccessKey)
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
            "resources": data.state.private.awsResources,
            errors: data.state.private.awsAccounts.filter(a => a.work.errorStr).map(a => ({
                accountId: a.accountId,
                arn: a.arn,
                email: a.email,
                errorStr: a.work.errorStr
            })).flat()
        }
    }
    return data
}

export async function setCredentials(data: AWSData<AWSSecretsInput>): Promise<Data> {
    data.state.private.credentials = {
        accessKeyId: data.request.body.accessKeyId,
        secretAccessKey: data.request.body.secretAccessKey
    }
    data.state.public.maskedCredentials = {
        accessKeyId: maskString(data.request.body.accessKeyId),
        secretAccessKey: maskString(data.request.body.secretAccessKey)
    }
    data.response = {
        statusCode: 200,
        body: "OK"
    }
    return data
}