# Deploying to the VPS, step by step

You have SSH. The code comes from git; only the secrets and the paid files go
over scp, because those are deliberately not in the repository.

Replace `VPS_IP` throughout. Everything runs as the `ubuntu` user created in step 0.

---

## 0. Create a non-root user first

Everything below runs as `ubuntu`, not root. As root, on the VPS:

```bash
adduser ubuntu                 # prompts for a password, the rest can be blank
usermod -aG sudo ubuntu
```

Give it your SSH key so you can log in the same way you log in as root:

```bash
rsync --archive --chown=ubuntu:ubuntu ~/.ssh /home/ubuntu/
```

**Now open a SECOND terminal and prove it works before you touch anything else:**

```bash
ssh ubuntu@VPS_IP
sudo whoami                    # must print: root
```

Only once that succeeds, go back to the root session and close the door:

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no      # only if you are certain your key works
```

```bash
sudo systemctl reload ssh      # 'sshd' on some distros
```

Keep the root session open until you have opened yet another new connection as
`ubuntu` and confirmed it still works. A reload does not drop existing sessions,
which is what gives you a way back if the config is wrong.

## 1. On the VPS: install Docker

```bash
ssh ubuntu@VPS_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit          # log out and back in so the group membership applies
```

```bash
ssh ubuntu@VPS_IP
docker --version && docker compose version
docker run --rm hello-world     # proves ubuntu can use docker without sudo
```

## 2. Clone the site

```bash
git clone -b medpsycmoss https://github.com/byteboom-ai/websites.git medpsycmoss
cd medpsycmoss
```

Updating later is `git pull && docker compose up -d --build`, which is the whole
reason not to scp the site across.

## 3. Send the secrets

`docker-compose.yml` sits at the repo root, so `.env` goes beside it. From your
machine:

```bash
scp local-site/.env ubuntu@VPS_IP:~/medpsycmoss/.env
```

Then on the VPS, fix the one value that must differ in production:

```bash
cd ~/medpsycmoss
sed -i 's|^SITE_ORIGIN=.*|SITE_ORIGIN=https://medpsycmoss.com|' .env
sed -i 's|^PORT=.*|PORT=8080|' .env      # the port inside the container
chmod 600 .env
grep -c . .env                            # sanity check it arrived
```

**`SITE_ORIGIN` matters.** It is where Stripe sends the buyer after paying. Leave
it as localhost and every customer is redirected to a dead address the moment
they have handed over money.

## 4. Start it

```bash
docker compose up -d --build
docker compose ps                    # expect healthy
curl -I http://127.0.0.1:8899/       # expect 200
```

It binds to loopback on purpose. TLS comes from the proxy in the next step.

## 5. TLS

Nothing answers on port 80 until this is done. The container binds to loopback
on purpose, so `curl http://your-domain` refusing to connect before this step is
expected, not a fault.

Caddy is not in Ubuntu's default repositories, so add theirs:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key'   | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt'   | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

`/etc/caddy/Caddyfile` **must list only hostnames that already point at this
box.** Caddy asks Let's Encrypt for a certificate on boot, and a name pointing
somewhere else fails and can hold up the others:

```
new.medpsycmoss.com {
    reverse_proxy 127.0.0.1:8899
}
```

Add `medpsycmoss.com, www.medpsycmoss.com` to that line only after you move the
apex DNS in step 7. Until then those names still resolve to Gator.

```bash
systemctl reload caddy
systemctl status caddy --no-pager | head -5
journalctl -u caddy -n 20 --no-pager     # watch the certificate being issued
```

Open the firewall, or Let's Encrypt cannot reach the box to validate:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Then from your own machine, not the VPS:

```bash
curl -I https://new.medpsycmoss.com/
```

## 6. Send the paid product files and the catalogue

These are the files customers pay for. They are gitignored on purpose and are
not in the image either, so they have to go over by hand, once.

```bash
# from your machine
scp -r local-site/content/products ubuntu@VPS_IP:~/upload
```

```bash
# on the VPS, into the running container's volume
docker cp ~/upload/. medpsycmoss-site:/app/content/products/
docker exec medpsycmoss-site ls -la /app/content/products/
rm -rf ~/upload
```

Expect exactly these seven, and the names must match `content/products.json`:

```
advising-appointment-instructions.pdf          21 KB
mock-interview-instructions.pdf                21 KB
eras-ps-fellowship-2026.pdf                   168 KB
full-residency-eras-application.pdf           197 KB
residency-mock-interview-course.pdf           3.3 MB
medical-school-application-workbook.pdf       6.0 MB
residency-application-workbook.pdf            6.6 MB
```

**Then push the catalogue itself.** This step is easy to miss and silently does
nothing if you skip it. `content/` is a volume and the entrypoint never
overwrites a file that already exists there, because she edits products in the
editor and her edits must win. So a catalogue change made in git does **not**
reach a running server on its own:

```bash
# from your machine
scp local-site/content/products.json ubuntu@VPS_IP:~/products.json
```

```bash
# on the VPS
docker cp ~/products.json medpsycmoss-site:/app/content/products.json
docker compose restart
rm ~/products.json
```

Confirm all nine visible products arrived:

```bash
curl -s http://127.0.0.1:8899/store/ | grep -c 'data-buy='     # expect 9
```

Nine, not ten: the Medical School Application Workbook is `visible: false`,
matching what Gator has hidden today. Its file still ships, so unhiding it is a
one word edit in `content/products.json`.

## 7. Point the domain

DNS is at Bluehost. Set the A records for `@` and `www` to the VPS IP.

**There is no MX record on this domain**, so there is no email to break. That is
the usual way a DNS move goes wrong and it does not apply here.

**Before you do this, read the sequencing note at the bottom.**

## 8. Check it end to end

```bash
curl -I https://medpsycmoss.com/                       # 200
curl -I https://medpsycmoss.com/store/                 # 200
curl -sI https://medpsycmoss.com/admin | head -1       # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     https://medpsycmoss.com/API/stripe/webhook        # 400, refusing unsigned
```

That last one returning **400 and not 404** is the important one: 400 means the
webhook route is reachable and rejecting an unsigned request, which is correct.
404 would mean orders silently never get fulfilled.

Then in Stripe: **Developers, Webhooks, your endpoint, Send test webhook**,
choose `checkout.session.completed`. It should show a 200 response, and the
Orders tab in `/admin` should show the test order.

## 9. Housekeeping

The firewall was opened in step 5. Port 8899 stays closed: Caddy reaches the
container over loopback, so it never needs to be exposed.

Back up the volume on a schedule, because it holds everything she writes plus
every order:

```bash
docker run --rm -v medpsycmoss_content:/c -v $PWD:/b alpine \
  tar czf /b/content-$(date +%F).tgz /c
```

---

## The sequencing that actually matters

**The moment the A record moves, Gator stops serving her site, including the
shop.** Before you switch DNS, all of these must be true:

1. The site is up on the VPS over HTTPS and you have clicked through it
2. The contact form has a recipient address, or student enquiries vanish silently
3. Either the new store is taking payments, or `store.medpsycmoss.com` is live on
   Gator and the checkout links point there

And before cutover, because they cannot be recovered afterwards:

- export her Gator orders, customers and product files
- screenshot 12 months of traffic stats: they are generated by the server that
  hosts the site and stop the day it moves. The new site counts its own traffic
  from launch day, and she sees it on a card in the editor, but there is no
  history to import: see reports/traffic.md
- have Google Analytics and Search Console already running on the new site

## Update later

```bash
ssh ubuntu@VPS_IP
cd ~/medpsycmoss
git pull
docker compose up -d --build
```

`content/` is a volume, so everything she has written and every order survives.
`rebuild/` and `dist/` come fresh from the image, so your changes land. The
entrypoint rebuilds from both at every start.
