-- Outgoing scheduler requests carry a private job token in the headers.
revoke select on net.http_request_queue from public, anon, authenticated;
