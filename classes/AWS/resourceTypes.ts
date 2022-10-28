export default {
    "AWS::IAM::User": {
        "label": "IAM User",
        "actions": [
            {
                "label": "Delete",
                "action": "deleteIAMUser"
            },
            {
                "label": "Disable",
                "action": "disableIAMUser"
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