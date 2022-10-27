//const AWS = require('aws-sdk')
import AWS from 'aws-sdk'
import { Account } from 'aws-sdk/clients/organizations'
import _ from 'lodash'


export default class AWSHandler {

    organizations: AWS.Organizations
    accessKeyId: string
    secretAccessKey: string

    constructor(accessKeyId: string, secretAccessKey: string) {
        this.accessKeyId = accessKeyId
        this.secretAccessKey = secretAccessKey
        this.organizations = new AWS.Organizations({
            region: 'us-east-1',
            endpoint: 'https://organizations.us-east-1.amazonaws.com',
            credentials: {
                accessKeyId,
                secretAccessKey
            }
        })
    }

    getAllAWSAccountsInOrganization = async () : Promise<Account[]> => {

        // Get all accounts in the organization by paging through results with NextToken
        let nextToken = null

        let accounts: Account[] = []

        while (nextToken !== undefined) {
            const response = await this.organizations.listAccounts({
                NextToken: nextToken
            }).promise()

            accounts = accounts.concat(response.Accounts)
            nextToken = response.NextToken
            console.log("nextToken", nextToken)
        }

        return accounts
    }

    assumeAWSAccount = async (account:Account, roleName:string) : Promise<AWS.STS.Credentials> => {

        console.log("trying to assume", account)
    
        var roleToAssume = {
            RoleArn: `arn:aws:iam::${account.Id}:role/${roleName}`,
            RoleSessionName: 'session1',
            DurationSeconds: 900,
        };
    
        // Create the STS service object    
        var sts = new AWS.STS({ 
            apiVersion: '2011-06-15',
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey
            }
         });
    
        //Assume Role
        const data = await sts.assumeRole(roleToAssume).promise()
    
        return {
            AccessKeyId: data.Credentials.AccessKeyId,
            SecretAccessKey: data.Credentials.SecretAccessKey,
            SessionToken: data.Credentials.SessionToken,
            Expiration: data.Credentials.Expiration
        }
    }


    fillUserDetails = async (user, creds:AWS.STS.Credentials) => {
        
        // console.log("getting details for userId", user.UserId)

        const iam = new AWS.IAM({
            credentials: {
                accessKeyId: creds.AccessKeyId,
                secretAccessKey: creds.SecretAccessKey,
                sessionToken: creds.SessionToken
            }
        })
    
        let mfaDevicesResp = await iam.listMFADevices({
            UserName: user.UserName
        }).promise()
    
        user.mfaDevices = mfaDevicesResp.MFADevices
    }

    getAccountAuthorizationDetails = async (creds:AWS.STS.Credentials) : Promise<any> => {

        const iam = new AWS.IAM({
            credentials: {
                accessKeyId: creds.AccessKeyId,
                secretAccessKey: creds.SecretAccessKey,
                sessionToken: creds.SessionToken
            }
            // credentials: creds
        })
    
        let users = []
        let groups = []
        let roles = []
        let policies = []

        let marker = null

        while (marker !== undefined) {
    
            let authDetails = await iam.getAccountAuthorizationDetails({
                Filter: ["User", "Group"],
                Marker: marker
            }).promise()

            users = users.concat(authDetails.UserDetailList)
    
            const chunks = _.chunk(authDetails.UserDetailList, 5)
            
            console.log("Marker", marker)
            console.log("chunks count", chunks.length)

            for(let c of chunks) {
                let p = []
                console.log("user count in chunk", c.length)
                for(let u of c) {
                    p.push(this.fillUserDetails(u, creds))
                }
                await Promise.all(p)
            }

            // _.chunk(users, 2).forEach(async (userChunk) => {
            //     await Promise.all(userChunk.map(async (user) => {
            //         await this.fillUserDetails(user, creds)
            //     }))
            // })

            groups = groups.concat(authDetails.GroupDetailList)
            roles = roles.concat(authDetails.RoleDetailList)
            // policies = policies.concat(authDetails.Policies)

            marker = authDetails.Marker
        }
    
        return {
            users,
            groups,
            roles,
            policies
        }
    }


}





