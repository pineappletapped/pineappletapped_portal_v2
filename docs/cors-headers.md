# Cloud Function CORS headers

The shared CORS helper at `functions/src/utils/httpCors.ts` sets the response headers for
`recordLogin`, `analytics_track`, and `createOrder` before handling either the preflight
or the actual POST request. When the caller origin matches one of the allowed domains,
the Cloud Function replies with:

| Header | Value |
| --- | --- |
| `Access-Control-Allow-Origin` | The validated origin, including `https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app`, `https://europe-west2-pineapple-tapped---portal.cloudfunctions.net`, or `https://europe-west2-ptfbportalbackend.cloudfunctions.net`. |
| `Access-Control-Allow-Credentials` | `true` |
| `Access-Control-Allow-Methods` | `POST, OPTIONS` |
| `Access-Control-Max-Age` | `3600` |
| `Access-Control-Allow-Headers` | The `Access-Control-Request-Headers` supplied by the browser preflight, or the default `Content-Type, Authorization`. |

During an OPTIONS preflight the helper returns immediately after writing these headers,
so the browser can see them on the 204 response before it attempts the POST.
