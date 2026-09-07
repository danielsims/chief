-- Native OAuth permits any OS-assigned port for this exact loopback host/path.
-- Keep existing redirects so installed desktop builds can still sign in.
UPDATE `oauth_client`
SET `redirect_uris` = json_insert(
  `redirect_uris`, '$[#]', 'http://127.0.0.1/auth/desktop'
)
WHERE `client_id` = 'chief-desktop'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`oauth_client`.`redirect_uris`)
    WHERE value = 'http://127.0.0.1/auth/desktop'
  );
