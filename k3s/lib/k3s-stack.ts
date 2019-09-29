import fs = require("fs");
import cdk = require("@aws-cdk/core");
import iam = require("@aws-cdk/aws-iam");
import ec2 = require("@aws-cdk/aws-ec2");
import autoscaling = require("@aws-cdk/aws-autoscaling");

function tap<T>(value: T, fn: (value: T) => void): T {
  fn(value);
  return value;
}

export class K3SStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // iam role for ec2
    const master_role = new iam.Role(this, "IAMRoleMaster", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      inlinePolicies: {
        k3s_write_master_info: tap(new iam.PolicyDocument(), doc => {
          doc.addStatements(
            tap(new iam.PolicyStatement({ effect: iam.Effect.ALLOW }), st => {
              st.addActions("ssm:PutParameter");
              st.addResources("arn:aws:ssm:*:*:parameter/k3s/master/*");
            })
          );
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM")
      ]
    });
    const agent_role = new iam.Role(this, "IAMRoleAgent", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      inlinePolicies: {
        k3s_read_master_info: tap(new iam.PolicyDocument(), doc => {
          doc.addStatements(
            tap(new iam.PolicyStatement({ effect: iam.Effect.ALLOW }), st => {
              st.addActions("ssm:GetParameter");
              st.addResources("arn:aws:ssm:*:*:parameter/k3s/master/*");
            })
          );
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM")
      ]
    });

    // vpc / networks
    const vpc = new ec2.Vpc(this, "VPC", {
      cidr: "10.0.0.0/22",
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Master",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28
        },
        {
          name: "Agent",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        }
      ]
    });

    const secgroup = new ec2.SecurityGroup(this, "SecurityGroup", { vpc });
    secgroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTcp());

    // launch template with userdata
    const amzn2_image_id = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
    }).getImage(this).imageId;
    const root_block_device = (size: number): ec2.CfnLaunchTemplate.BlockDeviceMappingProperty => {
      return {
        deviceName: "/dev/xvda",
        ebs: {
          deleteOnTermination: true,
          volumeSize: size,
          volumeType: "gp2"
        }
      };
    };
    const master_template = new ec2.CfnLaunchTemplate(this, "MasterTemplate", {
      launchTemplateData: {
        instanceType: new ec2.InstanceType("t3.micro").toString(),
        imageId: amzn2_image_id,
        networkInterfaces: [
          {
            associatePublicIpAddress: true,
            deviceIndex: 0,
            groups: [secgroup.securityGroupId],
            subnetId: vpc.selectSubnets({ subnetName: "Master" }).subnetIds[0]
          }
        ],
        blockDeviceMappings: [root_block_device(8)],
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "InstanceProfileMaster", {
            roles: [master_role.roleName]
          }).attrArn
        },
        userData: fs.readFileSync("lib/userdata/master.sh").toString("base64")
      }
    });
    const agent_template = new ec2.CfnLaunchTemplate(this, "AgentTemplate", {
      launchTemplateData: {
        instanceType: new ec2.InstanceType("t3.micro").toString(),
        imageId: amzn2_image_id,
        networkInterfaces: [
          {
            associatePublicIpAddress: true,
            deviceIndex: 0,
            groups: [secgroup.securityGroupId]
          }
        ],
        blockDeviceMappings: [root_block_device(8)],
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "InstanceProfileAgent", {
            roles: [agent_role.roleName]
          }).attrArn
        },
        userData: fs.readFileSync("lib/userdata/agent.sh").toString("base64")
      }
    });

    // autoscaling group
    new autoscaling.CfnAutoScalingGroup(this, "AgentScalingGroup", {
      maxSize: "4",
      minSize: "0",
      launchTemplate: {
        version: agent_template.attrLatestVersionNumber,
        launchTemplateId: agent_template.ref
      },
      vpcZoneIdentifier: vpc.selectSubnets({ subnetName: "Agent" }).subnetIds
    });
  }
}
