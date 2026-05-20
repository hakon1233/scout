import * as React from "react";
import { Button } from "./Button";
import { Card } from "./Card";

type Action = {
  label: string;
  onClick: () => void;
};

type Props = {
  title: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  primary?: Action;
  secondary?: Action;
  className?: string;
};

export function EmptyState({
  title,
  body,
  icon,
  primary,
  secondary,
  className = "",
}: Props) {
  return (
    <Card
      tone="dashed"
      padding="lg"
      className={`flex flex-col items-center gap-3 text-center ${className}`}
      role="status"
    >
      {icon && <div aria-hidden className="text-muted">{icon}</div>}
      <h2 className="text-title-3 text-primary">{title}</h2>
      {body && <p className="max-w-md text-body-sm text-secondary">{body}</p>}
      {(primary || secondary) && (
        <div className="mt-2 flex flex-col gap-2 min-[480px]:flex-row">
          {primary && (
            <Button variant="primary" size="md" onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button variant="secondary" size="md" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
