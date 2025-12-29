---
description: Deploy to Vercel
---

# Deployment Workflow

This project is automatically deployed to Vercel when changes are pushed to GitHub.

## Git Repository
- **Repository**: `gapbbong/signscheck`
- **URL**: `https://github.com/gapbbong/signscheck`

## Deployment Steps

// turbo-all
1. Commit your changes:
```bash
git add .
git commit -m "Your commit message"
```

2. Push to GitHub (Vercel will auto-deploy):
```bash
git push origin main
```

## Vercel Dashboard
- Deployment status: https://vercel.com/dashboard
- Live site: https://signscheck.vercel.app

## Notes
- Vercel automatically deploys on push to `main` branch
- Build logs are available in Vercel dashboard
- Environment variables are configured in Vercel project settings
