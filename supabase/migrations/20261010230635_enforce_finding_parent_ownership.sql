alter policy findings_owner on public.findings
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.scans
      where scans.id = findings.scan_id and scans.user_id = auth.uid()
    )
  );

alter policy finding_steps_owner on public.finding_steps
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.findings
      where findings.id = finding_steps.finding_id and findings.user_id = auth.uid()
    )
  );

alter policy finding_messages_owner on public.finding_messages
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.scans
      where scans.id = finding_messages.scan_id and scans.user_id = auth.uid()
    )
  );
