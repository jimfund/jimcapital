# jim.capital

A minimal static website hosted on GitHub Pages, displaying an animated crystal ball.
The original GIF is stored locally at `assets/prediction.gif`.

GitHub Pages publishes the root of the `main` branch. Edit `index.html`, commit,
and push to update the website. No build tools or dependencies are required.

## Domain setup

In Namecheap, open **Domain List → jim.capital → Manage → Advanced DNS**.
Set these host records (TTL: Automatic):

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | jimfund.github.io |

Remove conflicting parking or URL redirect records for `@` and `www`.
Preserve email-related MX and TXT records.

The GitHub Pages custom domain is `jim.capital`. Once DNS resolves to GitHub
and its TLS certificate is issued, enable **Enforce HTTPS** in
[Settings → Pages](https://github.com/jimfund/jimcapital/settings/pages).

References:
- [Namecheap setup](https://www.namecheap.com/support/knowledgebase/article.aspx/9645/2208/how-do-i-link-my-domain-to-github-pages/)
- [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
