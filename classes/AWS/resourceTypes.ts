export default {
    "AWS::Organizations::Account": {
        "label": "AWS Account",
        "actions": [
        ]
    },
    "AWS::IAM::User": {
        "label": "IAM User",
        "actions": [
            {
                "label": "Delete",
                "action": "deleteIAMUser"
            },
            {
                "label": "Delete Unused Access Keys",
                "action": "deleteUnusedAccessKeysForUser"
            }
        ]
    },
    "AWS::IAM::Group": {
        "label": "IAM Group",
        "actions": [
            {
                "label": "Delete",
                "action": "deleteIAMGroup"
            }
        ]
    },
    "AWS::IAM::Role": {
        "label": "IAM Role",
        "actions": [
        ]
    }
}