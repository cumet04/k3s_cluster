#!/bin/bash

# ssm-ssh ----------
yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm

passwd -d ec2-user

sed -i /etc/ssh/sshd_config -e 's/^#PermitEmptyPasswords.*$/PermitEmptyPasswords yes/g'
sed -i /etc/ssh/sshd_config -e 's/^PasswordAuthentication no$/#PasswordAuthentication no/g'
sed -i /etc/ssh/sshd_config -e 's/^UsePAM yes$/#UsePAM yes/g'
systemctl reload sshd

# k3s ----------

K3S_VERSION="v1.18.2+k3s1"
BIN_DIR=/usr/local/bin

## agent
cat > /opt/k3s_env_setup.sh << 'EOF'
#!/bin/bash

host=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/host | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo "K3S_URL=https://${host}:6443" > /opt/k3s.env

token=$(aws ssm get-parameter --region ap-northeast-1 --name /k3s/master/token | grep '"Value"' | sed 's|[^:]*: "\([^"]*\).*|\1|')
echo -n "K3S_TOKEN=$token" >> /opt/k3s.env
EOF
chmod +x /opt/k3s_env_setup.sh
touch /opt/k3s.env

service_section="
Type=exec
ExecStart=/usr/local/bin/k3s agent
EnvironmentFile=/opt/k3s.env
ExecStartPre=/opt/k3s_env_setup.sh
"

## common
curl -L "https://github.com/rancher/k3s/releases/download/$K3S_VERSION/k3s" -o $BIN_DIR/k3s
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
