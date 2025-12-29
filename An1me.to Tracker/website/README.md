# An1me.to Tracker Website

Professional landing page for the An1me.to Tracker Chrome Extension, designed for Google OAuth consent screen verification.

## 📁 File Structure

```
website/
├── index.html              # Main landing page
├── privacy-policy.html     # Privacy Policy (GDPR compliant)
├── terms-of-service.html   # Terms of Service
├── style.css               # Shared styles
├── README.md               # This file
└── assets/                 # Images and media
    ├── favicon-16x16.png   # Favicon (copy from src/icons)
    ├── favicon-32x32.png   # Favicon
    ├── apple-touch-icon.png
    ├── og-image.png        # Social sharing image (1200x630)
    ├── screenshot-main.png # Main extension screenshot
    ├── screenshot-collapsed.png
    ├── screenshot-expanded.png
    └── screenshot-settings.png
```

## 🚀 Deployment to GitHub Pages

### Option 1: Deploy from `website` folder (Recommended)

1. **Create a new GitHub repository** or use your existing anime extension repo

2. **Push the website folder:**
   ```bash
   cd D:\Projects\anime
   git add website/
   git commit -m "Add website for OAuth verification"
   git push origin main
   ```

3. **Enable GitHub Pages:**
   - Go to your repo → Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/website` (or root if you moved files there)
   - Click Save

4. **Your site will be live at:**
   - `https://YOUR_USERNAME.github.io/REPO_NAME/`

### Option 2: Dedicated `gh-pages` branch

1. Create orphan branch:
   ```bash
   git checkout --orphan gh-pages
   git rm -rf .
   ```

2. Copy website files to root:
   ```bash
   cp -r website/* .
   rm -rf website
   git add .
   git commit -m "Initial website deploy"
   git push origin gh-pages
   ```

3. Enable GitHub Pages from `gh-pages` branch

### Option 3: Separate Repository

1. Create new repo named `YOUR_USERNAME.github.io` for personal site
   or `anime-tracker` for project site

2. Copy all files from `website/` to the new repo root

3. Push and enable GitHub Pages

## 📸 Required Screenshots

Before deploying, add these images to the `assets` folder:

### 1. `screenshot-main.png` (Required)
- Main extension popup screenshot
- Recommended size: 400x560px (matches popup dimensions)
- Show the main anime list view

### 2. `screenshot-collapsed.png`
- Popup with collapsed anime cards
- Copy from: `screenshots/colapse.png`

### 3. `screenshot-expanded.png`
- Popup with expanded anime card details
- Copy from: `screenshots/expand.png`

### 4. `screenshot-settings.png`
- Settings menu dropdown
- Copy from: `screenshots/settings.png`

### 5. `og-image.png` (For Social Sharing)
- Dimensions: 1200x630px
- Include: Logo, name, brief tagline

### Quick Screenshot Copy Commands:
```bash
cd D:\Projects\anime
copy "screenshots\colapse.png" "website\assets\screenshot-collapsed.png"
copy "screenshots\expand.png" "website\assets\screenshot-expanded.png"
copy "screenshots\settings.png" "website\assets\screenshot-settings.png"
copy "screenshots\site-demo.png" "website\assets\screenshot-main.png"
copy "src\icons\icon16.png" "website\assets\favicon-16x16.png"
copy "src\icons\icon32.png" "website\assets\favicon-32x32.png"
copy "src\icons\icon128.png" "website\assets\apple-touch-icon.png"
```

## 🔧 Configuration

### Update URLs

Before deploying, update these URLs in the HTML files:

1. **index.html:**
   - Replace `YOUR_EXTENSION_ID` with your actual Chrome Web Store extension ID
   - Update `https://yourusername.github.io/anime-tracker/` with your actual GitHub Pages URL
   - Update GitHub profile link

2. **Open Graph meta tags** (for social sharing):
   ```html
   <meta property="og:url" content="https://YOUR_USERNAME.github.io/anime-tracker/">
   <meta property="og:image" content="https://YOUR_USERNAME.github.io/anime-tracker/assets/og-image.png">
   ```

### Custom Domain (Optional)

1. Add a `CNAME` file to the website folder:
   ```
   yourdomain.com
   ```

2. Configure DNS:
   - A records pointing to GitHub Pages IPs
   - Or CNAME record for subdomain

## ✅ Google OAuth Verification Checklist

Before submitting for OAuth verification, ensure:

- [ ] Website is publicly accessible
- [ ] All three pages are on the same domain:
  - [ ] Home page (index.html)
  - [ ] Privacy Policy (privacy-policy.html)
  - [ ] Terms of Service (terms-of-service.html)
- [ ] Contact email is visible (thomasthanos28@gmail.com)
- [ ] App name and logo are clearly displayed
- [ ] Privacy Policy explains:
  - [ ] What data is collected
  - [ ] How data is used
  - [ ] Data storage and security
  - [ ] Third-party services (Firebase, Google)
  - [ ] User rights (GDPR)
- [ ] Terms of Service covers:
  - [ ] Acceptable use
  - [ ] Disclaimers
  - [ ] Liability limitations

## 🎨 Design Notes

- **Color Scheme:** Dark theme with red/purple accents (matches extension UI)
- **Typography:** Inter font for clean, modern look
- **Responsive:** Mobile-first design, works on all devices
- **Performance:** No external dependencies except Google Fonts

## 📝 Updating Content

### To update the Privacy Policy:
Edit `privacy-policy.html` and update the "Last Updated" date.

### To update Terms of Service:
Edit `terms-of-service.html` and update the "Last Updated" date.

### To change styling:
All styles are in `style.css` with CSS custom properties for easy theming.

## 📧 Support

For questions or issues:
- Email: thomasthanos28@gmail.com
- GitHub: [ThomasThanos](https://github.com/ThomasThanos)
