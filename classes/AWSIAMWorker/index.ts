import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import AWS from "aws-sdk";
import { InitBody, AWSSecretsInput, AWSWorkerStartInput, DeleteUserInput } from './rio'
import AWSHandler from './aws'
const rdk = new RDK();
import _ from 'lodash'

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

interface AWSIAMWorkerDataPublicState {

}


interface AWSIAMWorkerDataPrivateState {
    email: string
}



interface AWSIAMWorkerData<I = any, O = any> extends Data<I, O, AWSIAMWorkerDataPublicState, AWSIAMWorkerDataPrivateState> {

}

export async function getInstanceId(data: Data<InitBody>): Promise<string> {
    return data.request.body.email
}

export async function authorizer(data: Data): Promise<Response> {

    if (data.context.methodName === 'deleteIAMUser') {
        return { statusCode: 401, body: { message: 'Unauthorized' } }
    }

    return { statusCode: 200 };
}

export async function init(data: AWSIAMWorkerData<InitBody>): Promise<Data> {
    data.state.private = {
        email: data.request.body.email
    }
    return data
}

export async function getState(data: Data): Promise<Response> {
    return { statusCode: 200, body: data.state };
}

interface AWSResource {
    arn: string
    label: string
    accountId: string
    config: any
    resourceType: string
}

export async function start(data: AWSIAMWorkerData<AWSWorkerStartInput>): Promise<Data> {

    await rdk.methodCall({
        classId: "AWS",
        instanceId: data.context.instanceId,
        methodName: "receiveWorkerEvents",
        body: {
            accountId: data.request.body.accountId,
            status: "running",
        }
    })

    // Fetch aws account list
    const awsHandler = new AWSHandler({
        accessKeyId: data.request.body.accessKeyId,
        secretAccessKey: data.request.body.secretAccessKey,
        sessionToken: data.request.body.sessionToken
    })

    const authDetails = await awsHandler.getAccountAuthorizationDetails()

    // Convert authDetails to a flat array of AWSResource objects
    const resources: AWSResource[] = []

    authDetails.users.forEach((user: IamUser) => {
        resources.push({
            arn: user.Arn,
            accountId: user.Arn.split(":")[4],
            label: user.UserName,
            config: {
                ...(_.omit(user, ["UserPolicyList"])),
                UserPolicyList: user.UserPolicyList.map((policy) => {
                    return {
                        PolicyName: policy.PolicyName
                    }
                })
            },
            resourceType: "AWS::IAM::User"
        })
    })
    authDetails.groups.forEach((group: any) => {
        resources.push({
            arn: group.Arn,
            label: group.GroupName,
            accountId: group.Arn.split(":")[4],
            config: group,
            resourceType: "AWS::IAM::Group"
        })
    })
    authDetails.roles.forEach((role: any) => {
        resources.push({
            arn: role.Arn,
            label: role.RoleName,
            accountId: role.Arn.split(":")[4],
            config: _.omit(role, ['AssumeRolePolicyDocument', 'RolePolicyList']),
            resourceType: "AWS::IAM::Role"
        })
    })
    // authDetails.Policies.forEach((policy: any) => {
    //     resources.push({
    //         arn: policy.Arn,
    //         accountId: policy.Arn.split(":")[4],
    //         data: policy
    //     })
    // })


    await rdk.methodCall({
        classId: "AWS",
        instanceId: data.context.instanceId,
        methodName: "receiveWorkerEvents",
        body: {
            accountId: data.request.body.accountId,
            status: "finished",
            data: resources
        }
    })

    return data
}

// implement deleteUser
export async function deleteIAMUser(data: AWSIAMWorkerData<DeleteUserInput>): Promise<Data> {

    const awsHandler = new AWSHandler({
        accessKeyId: data.request.body.accessKeyId,
        secretAccessKey: data.request.body.secretAccessKey,
        sessionToken: data.request.body.sessionToken
    })
    try {
        await awsHandler.deleteIAMUser(data.request.body.userName)
        data.response = {
            statusCode: 200,
            body: {
                message: "User deleted"
            }
        }
    } catch (err) {
        data.response = {
            statusCode: 500,
            body: {
                message: err.message
            }
        }
    }

    return data
}

// implement deleteUnusedAccessKeys
export async function deleteUnusedAccessKeysForUser(data: AWSIAMWorkerData<DeleteUserInput>): Promise<Data> {

    const awsHandler = new AWSHandler({
        accessKeyId: data.request.body.accessKeyId,
        secretAccessKey: data.request.body.secretAccessKey,
        sessionToken: data.request.body.sessionToken
    })
    try {
        await awsHandler.deleteUnusedAccessKeysForUser(data.request.body.userName)
        data.response = {
            statusCode: 200,
            body: {
                message: "Unused access keys deleted"
            }
        }
    } catch (err) {
        data.response = {
            statusCode: 500,
            body: {
                message: err.message
            }
        }
    }

    return data
}