const retrieveAuthToken = (testingMode = false) => {
  const requestBody = {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: prepareJWTAssertion(testingMode),
  };

  log.debug("Requesting Access Token from Google", requestBody);
  const response = https.post({
    url: GOOGLE_TOKEN_URL,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  log.debug("Google Token Response Status", response.code);
  if (response.code == 200) {
    const tokenData = JSON.parse(response.body);
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in;
    log.audit(
      "Successfully Obtained Google Access Token.",
      "Expires in: " + expiresIn + "s"
    );
    // log.debug("accesstoken", accessToken);

    return accessToken;
  }

  log.error(
    "Failed to Obtain Google Access Token",
    "Status: " + response.code + " | Body: " + response.body
  );
  throw new Error("Failed to get access token. Status: " + response.code);
};

const prepareJWTAssertion = (testingMode = false) => {
  const header = prepareJWTHeader();
  const claimsSet = prepareJWTClaimsSet();

  const certId = resolveCertId(testingMode);

  const signer = certificate.createSigner({
    certId,
    algorithm: certificate.HashAlg.SHA256,
  });

  const signature = prepareJWTSignature(signer, `${header}.${claimsSet}`);

  return [header, claimsSet, signature].join(".");
};

const prepareJWTHeader = () => {
  const alg = "RS256";
  const type = "JWT";

  const header = { alg, type };
  const headerString = JSON.stringify(header);
  return base64UrlEncode(headerString);
};

const prepareJWTClaimsSet = (targetAudience = "") => {
  const ONE_HOUR = 3600;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expirySeconds = nowSeconds + ONE_HOUR;
  const clientEmail = SERVICE_ACCOUNT_EMAIL;

  const claimsSet = {
    // kid: '88a666f5dbd33273789633dffa6d6ab8ea8ff576',
    iss: clientEmail,
    sub: clientEmail,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: expirySeconds,
  };

  if (targetAudience) {
    claimsSet.target_audience = targetAudience;
  } else {
    claimsSet.scope = SCOPES.join(" ");
  }

  const claimsSetString = JSON.stringify(claimsSet);

  return base64UrlEncode(claimsSetString);
};

const resolveCertId = (testingMode = false) => {
  if (isProd(testingMode)) {
    return "custcertificate_wen_gcloud_cert";
  }

  return "custcertificate_mhi_self_sign_cert";
};

const prepareJWTSignature = (signer, input) => {
  signer.update({
    input,
  });

  return signer
    .sign({
      outputEncoding: encode.Encoding.BASE_64,
    })
    .replace(/=+$/, "");
};

const base64UrlEncode = (input) =>
  encode
    .convert({
      string: input,
      inputEncoding: encode.Encoding.UTF_8,
      outputEncoding: encode.Encoding.BASE_64_URL_SAFE,
    })
    .replace(/=+$/, "");
