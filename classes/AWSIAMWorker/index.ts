import RDK, { Data, InitResponse, Response, StepResponse } from "@retter/rdk";
import AWS from "aws-sdk";
import { InitBody, StartIAMFetchInput, AWSSecretsInput, AWSIAMWorkerStartInput } from './rio'
import AWSHandler from './aws'
const rdk = new RDK();

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
    return { statusCode: 401 };
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
    accountId: string
    data: any
    resourceType: string
}

export async function start(data: AWSIAMWorkerData<AWSIAMWorkerStartInput>): Promise<Data> {

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
            data: user,
            resourceType: "aws:iam:user"
        })
    })
    authDetails.groups.forEach((group: any) => {
        resources.push({
            arn: group.Arn,
            accountId: group.Arn.split(":")[4],
            data: group,
            resourceType: "aws:iam:group"
        })
    })
    // authDetails.RoleDetailList.forEach((role: any) => {
    //     resources.push({
    //         arn: role.Arn,
    //         accountId: role.Arn.split(":")[4],
    //         data: role
    //     })
    // })
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
