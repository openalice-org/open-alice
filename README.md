# Open Alice

This Vite/React application is deployed automatically to a private Amazon S3 bucket and served publicly through CloudFront.

## Run locally

Use Node.js 24 or later, then start the Vite development server.

### Install Node.js

#### Linux / macOS (nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
nvm install 24
```

#### macOS (Homebrew)

```bash
brew install node@24
```

More macOS install options (installer, MacPorts, fnm, etc.): [nodejs.org/en/download/package-manager](https://nodejs.org/en/download/package-manager#macos)

#### Windows (winget)

```powershell
winget install OpenJS.NodeJS.LTS
```

#### Windows (nvm-windows)

Install [nvm-windows](https://github.com/coreybutler/nvm-windows), then:

```powershell
nvm install 24
nvm use 24
```

You can also download the official installer for any platform from [nodejs.org/en/download](https://nodejs.org/en/download).

### Start the dev server

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite, normally [http://localhost:5173](http://localhost:5173). Stop the server with `Ctrl+C`.

## Deploy to S3

The workflow in [`.github/workflows/deploy-s3.yml`](.github/workflows/deploy-s3.yml) builds `dist/` and publishes it on every branch and tag push. It **overwrites the current files for that ref** and removes obsolete files; it does not retain a commit history.

| Git ref | S3 location | Website path |
| --- | --- | --- |
| `main` | bucket root | `/` |
| branch `publish/feature-map` | `branches/publish/feature-map/` | `/branches/publish/feature-map/` |
| tag `v1.0.0` | `tags/v1.0.0/` | `/tags/v1.0.0/` |

Only `main`, tags, and branches named `publish/*` deploy. When a `publish/*` branch is deleted, its `branches/<branch-name>/` prefix is deleted too. Tags are kept deliberately, even if a tag is removed.

To create a preview intentionally:

```bash
git switch -c publish/my-preview
git push -u origin publish/my-preview
```

### 1. Prepare the private bucket

1. Create or select an S3 bucket in the AWS region you will use.
2. Keep **Block all public access** enabled. Do not make this bucket public and do not add a public-read bucket policy.
3. Keep **Object Ownership** as **Bucket owner enforced** (ACLs disabled) and use **SSE-S3** encryption. Do not enable S3 static website hosting: CloudFront will use the private S3 REST origin instead.

### 2. Create the CloudFront distribution

1. Open **CloudFront → Create distribution**.
2. For **Origin domain**, select the S3 bucket from the list. This must be the regular S3 bucket origin, **not** an `s3-website-...` endpoint.
3. Under **Origin access**, select **Origin access control settings (recommended)**, create an OAC, and retain **Sign requests (recommended)**.
4. Set **Viewer protocol policy** to **Redirect HTTP to HTTPS** and leave allowed methods as `GET, HEAD`.
5. Set **Default root object** to `index.html`, then create the distribution.
6. When CloudFront offers to update the S3 bucket policy, accept it. Otherwise, add this policy in **S3 → bucket → Permissions → Bucket policy**, replacing all three placeholders:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowCloudFrontReadOnly",
         "Effect": "Allow",
         "Principal": { "Service": "cloudfront.amazonaws.com" },
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::YOUR_BUCKET/*",
         "Condition": {
           "StringEquals": {
             "AWS:SourceArn": "arn:aws:cloudfront::YOUR_AWS_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
           }
         }
       }
     ]
   }
   ```

7. Copy the distribution ID and domain name (for example, `d123example.cloudfront.net`). Use the CloudFront domain—not an S3 URL—for the website and iframes.

#### Preserve trailing-slash previews

CloudFront's private S3 origin does not automatically map `/branches/name/` to `index.html`. Create a **CloudFront Function**, publish it, and associate it with the distribution's **default behavior → Viewer request** event:

```javascript
function handler(event) {
  var request = event.request;
  if (request.uri.endsWith('/')) {
    request.uri += 'index.html';
  }
  return request;
}
```

This keeps preview URLs such as `https://d123example.cloudfront.net/branches/feature/map/` working, including their relative data files.

### 3. Create a deploy-only IAM user

Create an IAM user with an access key for GitHub Actions. Give it this policy, replacing `YOUR_BUCKET`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeployThisSiteOnly",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    },
    {
      "Sid": "WriteThisSiteOnly",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    },
    {
      "Sid": "InvalidateOnlyThisDistribution",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::YOUR_AWS_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
    }
  ]
}
```

Do not use an AWS root-account key. The policy allows the workflow to replace and delete only objects in this bucket.

### 4. Add GitHub configuration

In **GitHub → repository → Settings → Environments → `deployment`**, add:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `AWS_REGION` | The bucket region, for example `eu-west-1` |
| Variable | `S3_BUCKET` | The bucket name only, without `s3://` |
| Variable | `CLOUDFRONT_DISTRIBUTION_ID` | The ID copied from the CloudFront distribution |
| Variable | `CLOUDFRONT_DOMAIN` | The CloudFront domain, without `https://` |
| Secret | `AWS_ACCESS_KEY_ID` | Access key ID of the deploy-only IAM user |
| Secret | `AWS_SECRET_ACCESS_KEY` | Secret access key of the deploy-only IAM user |

#### Current repository values

The non-secret repository variables currently configured for this deployment are:

| Name | Value |
| --- | --- |
| `AWS_REGION` | `eu-central-1` |
| `S3_BUCKET` | `open-alice-shards` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E1834M3BDG8A2Z` |
| `CLOUDFRONT_DOMAIN` | `d385pc8be2cjhs.cloudfront.net` |

The two AWS access-key values intentionally remain GitHub Secrets only and must never be committed to this repository.

The workflow explicitly targets the `deployment` GitHub Environment, so its environment-scoped secrets and variables are available to both publishing and branch-cleanup jobs.

Each deployment publishes its URL in the GitHub Actions job summary and as the GitHub Environment deployment URL.

Push to `main`, any `publish/*` branch, or any tag to deploy. The workflow invalidates only the deployed CloudFront path, so changed files are available immediately. Open branch and tag previews with a trailing slash—for example `https://YOUR_DISTRIBUTION.cloudfront.net/branches/publish/feature-map/`—so the relative application data files resolve inside that preview.

### Production build

```bash
npm ci
npm run build
```

Vite copies `public/data/` into `dist/data/`. The workflow sets `VITE_BASE_PATH` so the compiled asset URLs work from the root, branch, and tag prefixes.
