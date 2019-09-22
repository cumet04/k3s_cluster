#!/bin/bash

# ssm-ssh ----------
yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm

passwd -d ec2-user

sed -i /etc/ssh/sshd_config -e 's/^#PermitEmptyPasswords.*$/PermitEmptyPasswords yes/g'
sed -i /etc/ssh/sshd_config -e 's/^PasswordAuthentication no$/#PasswordAuthentication no/g'
sed -i /etc/ssh/sshd_config -e 's/^UsePAM yes$/#UsePAM yes/g'
systemctl reload sshd

# k3s ----------

K3S_VERSION=v0.8.0
BIN_DIR=/usr/local/bin

## master
cat > /opt/k3s_env_put.sh << 'EOF'
#!/bin/bash

ip=$(hostname | cut -d'.' -f1 | cut -d'-' -f2,3,4,5 | tr '-' '.')
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/host --value "$ip" --type "String" --overwrite 

token=$(cat /var/lib/rancher/k3s/server/node-token)
aws ssm put-parameter --region ap-northeast-1 --name /k3s/master/token --value "$token" --type "String" --overwrite 
EOF
chmod +x /opt/k3s_env_put.sh

service_section="
Type=notify
Environment=K3S_KUBECONFIG_MODE=644
ExecStart=/usr/local/bin/k3s server --disable-agent
ExecStartPost=/opt/k3s_env_put.sh
"

## common
curl -L https://github.com/rancher/k3s/releases/download/$K3S_VERSION/k3s -o $BIN_DIR/k3s
chown root:root $BIN_DIR/k3s
chmod +x $BIN_DIR/k3s

for cmd in kubectl crictl ctr; do
  ln -s $BIN_DIR/k3s $BIN_DIR/$cmd
done

cat > /etc/systemd/system/k3s.service << EOF
[Unit]
Description=Lightweight Kubernetes
Documentation=https://k3s.io
After=network-online.target

[Service]
${service_section}
ExecStartPre=-/sbin/modprobe br_netfilter
ExecStartPre=-/sbin/modprobe overlay

KillMode=process
Delegate=yes
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now k3s
