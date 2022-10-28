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
                Filter: ["User", "Group", "Role"],
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

    deleteIAMUser = async (UserName: string) => {

        const iam = new AWS.IAM({
            credentials: this.credentials
        })

        // First delete login profile for this user
        try {
            await iam.deleteLoginProfile({
                UserName
            }).promise()
        } catch (err) {

        }


        // list all access keys for this user
        let accessKeysResp = await iam.listAccessKeys({
            UserName
        }).promise()

        // delete all access keys for this user
        for (let accessKey of accessKeysResp.AccessKeyMetadata) {
            try {
                await iam.deleteAccessKey({
                    UserName,
                    AccessKeyId: accessKey.AccessKeyId
                }).promise()
            } catch (err) {

            }

        }

        // list all attached policies for this user
        let attachedPoliciesResp = await iam.listAttachedUserPolicies({
            UserName
        }).promise()

        // detach all attached policies for this user
        for (let attachedPolicy of attachedPoliciesResp.AttachedPolicies) {
            try {
                await iam.detachUserPolicy({
                    UserName,
                    PolicyArn: attachedPolicy.PolicyArn
                }).promise()
            } catch (err) {

            }

        }

        // list all groups for this user
        let groupsResp = await iam.listGroupsForUser({
            UserName
        }).promise()

        // remove this user from all groups
        for (let group of groupsResp.Groups) {
            try {
                await iam.removeUserFromGroup({
                    UserName,
                    GroupName: group.GroupName
                }).promise()
            } catch (err) {

            }

        }

        // list all signing certificates for this user
        let signingCertificatesResp = await iam.listSigningCertificates({
            UserName
        }).promise()

        // delete all signing certificates for this user
        for (let signingCertificate of signingCertificatesResp.Certificates) {
            try {
                await iam.deleteSigningCertificate({
                    UserName,
                    CertificateId: signingCertificate.CertificateId
                }).promise()
            } catch (err) {

            }

        }

        // list all ssh public keys for this user
        let sshPublicKeysResp = await iam.listSSHPublicKeys({
            UserName
        }).promise()

        // delete all ssh public keys for this user
        for (let sshPublicKey of sshPublicKeysResp.SSHPublicKeys) {
            try {
                await iam.deleteSSHPublicKey({
                    UserName,
                    SSHPublicKeyId: sshPublicKey.SSHPublicKeyId
                }).promise()
            } catch (err) {

            }

        }

        // list all mfa devices for this user
        let mfaDevicesResp = await iam.listMFADevices({
            UserName
        }).promise()

        // delete all mfa devices for this user
        for (let mfaDevice of mfaDevicesResp.MFADevices) {
            try {
                await iam.deactivateMFADevice({
                    UserName,
                    SerialNumber: mfaDevice.SerialNumber
                }).promise()
            } catch (err) {

            }

        }

        // delete this user
        await iam.deleteUser({
            UserName
        }).promise()
    }


}





