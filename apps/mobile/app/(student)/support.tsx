import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BRAND, formatCampusDateTime, toAppError } from '@canteza/shared';
import { useCreateTicket, useMyTickets } from '../../src/lib/queries';
import { useIdentity } from '../../src/lib/session';
import {
  Badge,
  Body,
  Button,
  Card,
  Field,
  FormError,
  Heading,
  Loading,
  Screen,
} from '../../src/components/ui';
import { AppBar, CardTitle, SectionHeader } from '../../src/components/patterns';
import { useTheme } from '../../src/theme';

/**
 * Complaints, and what happened to them.
 *
 * Reached from an order ("Report a problem", which passes `?order=`) or on its own for
 * anything that is not about one order — `support_tickets.order_id` is nullable, so the
 * schema already allowed both and this screen is the reason it needed to.
 *
 * The list underneath is the point. A complaint form with no way to see the reply is a
 * suggestion box, and `support_tickets_own` already lets a student read their own
 * tickets including the `resolution` an admin writes back.
 */
export default function Support() {
  const t = useTheme();
  const identity = useIdentity();
  const { order } = useLocalSearchParams<{ order?: string }>();
  const orderId = order ?? null;

  const tickets = useMyTickets();
  const create = useCreateTicket();

  const [subject, setSubject] = useState(orderId ? 'Problem with my order' : '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit() {
    setError(null);
    if (!subject.trim()) {
      setError('Give it a subject so someone can triage it.');
      return;
    }
    create.mutate(
      {
        student_id: identity.userId,
        order_id: orderId,
        subject: subject.trim(),
        body: body.trim(),
      },
      {
        onSuccess: () => {
          setSubject('');
          setBody('');
          setSent(true);
        },
        onError: (cause) => setError(toAppError(cause).userMessage),
      },
    );
  }

  return (
    <Screen scroll>
      <AppBar title="Help & support" subtitle="We read every report" onBack={() => router.back()} />

      <Card>
        <CardTitle
          icon="chatbubbles-outline"
          title="Tell us what happened"
          subtitle={
            orderId
              ? 'This will be attached to the order you came from.'
              : `Anything about ${BRAND.name}`
          }
        />
        <Field
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          placeholder="Order arrived cold"
        />
        <Field
          label="Details"
          value={body}
          onChangeText={setBody}
          placeholder="What went wrong, and what would fix it"
          multiline
          maxLength={1000}
          hint="An admin reads every one of these."
        />
        <FormError message={error} />
        {sent ? <Badge label="✓ Sent — an admin will pick it up" tone="success" /> : null}
        <Button icon="send" label="Send report" loading={create.isPending} onPress={submit} />
      </Card>

      <SectionHeader title="Your previous reports" />
      {tickets.isLoading ? (
        <Loading label="Loading…" />
      ) : (tickets.data ?? []).length === 0 ? (
        <Text style={[t.font.body, { color: t.color.textMuted }]}>
          Nothing yet — and we hope it stays that way.
        </Text>
      ) : (
        <View style={{ gap: t.space.md }}>
          {(tickets.data ?? []).map((ticket) => (
            <Card key={ticket.id}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: t.space.md,
                }}
              >
                <Heading level="heading">{ticket.subject}</Heading>
                <Badge
                  label={ticket.status.replace('_', ' ')}
                  tone={
                    ticket.status === 'resolved'
                      ? 'success'
                      : ticket.status === 'closed'
                        ? 'neutral'
                        : 'info'
                  }
                />
              </View>
              <Body muted>{formatCampusDateTime(ticket.created_at)}</Body>
              {ticket.body ? <Body>{ticket.body}</Body> : null}
              {ticket.resolution ? (
                <View
                  style={{
                    gap: t.space.xs,
                    padding: t.space.md,
                    borderRadius: t.radius.md,
                    backgroundColor: t.color.successSoft,
                  }}
                >
                  <Text style={[t.font.overline, { color: t.color.success }]}>WHAT WE DID</Text>
                  <Body>{ticket.resolution}</Body>
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
