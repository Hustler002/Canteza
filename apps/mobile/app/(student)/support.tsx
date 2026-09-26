import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatCampusDateTime, toAppError } from '@canteza/shared';
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
import { AppBar } from '../../src/components/patterns';
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
      <AppBar title="Help" onBack={() => router.back()} />

      <Card>
        <Heading level="heading">Tell us what happened</Heading>
        {orderId ? <Body muted>This will be attached to the order you came from.</Body> : null}
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
        {sent ? <Badge label="Sent — an admin will pick it up" tone="success" /> : null}
        <Button label="Send" loading={create.isPending} onPress={submit} />
      </Card>

      <Heading level="title">Your previous reports</Heading>
      {tickets.isLoading ? (
        <Loading label="Loading…" />
      ) : (tickets.data ?? []).length === 0 ? (
        <Body muted>Nothing yet.</Body>
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
                <Card>
                  <Body muted>What we did</Body>
                  <Body>{ticket.resolution}</Body>
                </Card>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
