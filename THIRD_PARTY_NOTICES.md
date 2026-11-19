# Third-party notices

Parts of the SEO & AEO section are ported from OpenSEO (https://github.com/every-app/open-seo, commit 672a66c):

- `src/lib/seo/match.ts`: brand-mention matching, markdown-to-text and citation cleanup, from `server/features/ai-visibility/services/aiVisibilityMatching.ts` and `providers/dataforseoEvidence.ts`.
- `src/lib/seo/dataforseo.ts`: DataForSEO endpoints, request fields, response envelope handling and model selection, from `server/lib/dataforseo/*`.

Both were rewritten to drop OpenSEO's dependencies (zod, remeda, tldts, its error and billing layers). OpenSEO's license:

```
MIT License

Copyright (c) 2026 Ben Senescu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
