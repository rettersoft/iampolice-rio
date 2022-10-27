//const AWS = require('aws-sdk')
import AWS from 'aws-sdk'
import { Account } from 'aws-sdk/clients/organizations'
import _ from 'lodash'

interface AWSCredentials {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
}

export default class AWSHandler {

    credentials: AWSCredentials

    constructor(credentials: AWSCredentials) {
        this.credentials = credentials
    }

    fillUserDetails = async (user) => {

        const iam = new AWS.IAM({
            credentials: this.credentials
        })

        let mfaDevicesResp = await iam.listMFADevices({
            UserName: user.UserName
        }).promise()

        user.mfaDevices = mfaDevicesResp.MFADevices
    }

    getAccountAuthorizationDetails = async (): Promise<any> => {

        const iam = new AWS.IAM({
            credentials: this.credentials
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

            for (let c of chunks) {
                let p = []
                console.log("user count in chunk", c.length)
                for (let u of c) {
                    p.push(this.fillUserDetails(u))
                }
                await Promise.all(p)
            }

            groups = groups.concat(authDetails.GroupDetailList)
            roles = roles.concat(authDetails.RoleDetailList)

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





