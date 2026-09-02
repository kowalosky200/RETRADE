-- RETRADE Stage 2 RPC hardening — 2026-09-02
--
-- retrade_delete_my_account_record(text) is intentionally SECURITY DEFINER so
-- Partner/account deletion can atomically clear linked item ownership fields
-- and remove the account record. Its body is already ownership-scoped using
-- auth.uid(). This migration tightens execution privileges and search_path.

begin;

-- SECURITY DEFINER functions should not inherit an unnecessarily broad path.
-- Every referenced relation/function in the body is schema-qualified, so the
-- system catalog is sufficient for unqualified built-ins.
alter function public.retrade_delete_my_account_record(text)
  set search_path = pg_catalog;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default unless
-- revoked. Remove that inherited access so anon cannot invoke this RPC.
revoke execute on function public.retrade_delete_my_account_record(text) from public;
revoke execute on function public.retrade_delete_my_account_record(text) from anon;

-- The browser client signs in as authenticated and legitimately needs it.
grant execute on function public.retrade_delete_my_account_record(text) to authenticated;

-- Preserve server-side/service administration capability.
grant execute on function public.retrade_delete_my_account_record(text) to service_role;

commit;

-- Verification: expected anon=false, authenticated=true, service_role=true,
-- security_definer=true, function_config={search_path=pg_catalog}.
select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='retrade_delete_my_account_record';
