'use client';

import { ArrowRight, Workflow } from 'lucide-react';
import { useState } from 'react';
import type { ClientEvent } from '@/lib/client-controller';
import type { ServerEvent } from '@/lib/contracts';

export function EventTimeline({
  events,
  clientEvents,
}: {
  events: ServerEvent[];
  clientEvents: ClientEvent[];
}) {
  const [eventTab, setEventTab] = useState<'server' | 'client'>('server');
  const accepted = events.filter((event) => event.outcome !== 'conflict').length;
  const conflicts = events.filter((event) => event.outcome === 'conflict').length;
  const overwritten = events.filter((event) => event.outcome === 'overwritten').length;
  return (
    <section className="timeline-panel" aria-label="Event timeline">
      <div className="panel-heading">
        <div>
          <span className="panel-icon">
            <Workflow size={18} />
          </span>
          <h2>Event timeline</h2>
        </div>
        <fieldset className="event-tabs" aria-label="Event source">
          <button
            type="button"
            aria-pressed={eventTab === 'server'}
            onClick={() => setEventTab('server')}
          >
            Server
          </button>
          <button
            type="button"
            aria-pressed={eventTab === 'client'}
            onClick={() => setEventTab('client')}
          >
            Clients
          </button>
        </fieldset>
      </div>
      <div className="timeline-summary">
        <span>
          <strong>{accepted}</strong> accepted
        </span>
        <span>
          <strong>{conflicts}</strong> rejected
        </span>
        <span>
          <strong>{overwritten}</strong> overwritten
        </span>
        <span className="timeline-limit">latest 150</span>
      </div>
      <div className="event-list">
        {eventTab === 'server' ? (
          events.length ? (
            events.map((event) => (
              <div className={`event-row ${event.outcome}`} key={event.id}>
                <span className={`event-client ${event.clientId.toLowerCase()}`}>
                  {event.clientId === 'external' ? 'E' : event.clientId}
                </span>
                <div>
                  <div className="event-title">
                    <strong>
                      {event.outcome === 'conflict'
                        ? 'Stale write rejected'
                        : event.outcome === 'overwritten'
                          ? 'Newer content overwritten'
                          : event.operation === 'restore'
                            ? 'Checkpoint restored'
                            : 'Write committed'}
                    </strong>
                    <span className={`outcome ${event.outcome}`}>
                      {event.outcome === 'conflict' ? '409' : '200'}
                    </span>
                  </div>
                  <p>
                    expected <b>r{event.expectedRevision}</b>
                    <ArrowRight size={12} />
                    {event.outcome === 'conflict' ? 'server at' : 'committed'}{' '}
                    <b>r{event.revision}</b>
                  </p>
                  <span className="event-meta">
                    {event.mutationId.slice(0, 8)} ·{' '}
                    {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <EmptyEvents />
          )
        ) : clientEvents.length ? (
          clientEvents.map((event) => (
            <div className={`event-row ${event.kind}`} key={event.id}>
              <span className={`event-client ${event.clientId.toLowerCase()}`}>
                {event.clientId}
              </span>
              <div>
                <div className="event-title">
                  <strong>{event.detail}</strong>
                  <span className="client-event-kind">{event.kind}</span>
                </div>
                <span className="event-meta">
                  {event.mutationId ? `${event.mutationId.slice(0, 8)} · ` : ''}
                  {new Date(event.at).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyEvents />
        )}
      </div>
    </section>
  );
}
function EmptyEvents() {
  return (
    <div className="empty-events">
      <Workflow size={27} />
      <strong>Every race leaves a trace.</strong>
      <p>
        Make an edit or run a scenario.
        <br />
        Requests and outcomes will appear here.
      </p>
    </div>
  );
}
