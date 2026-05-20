import * as React from "react";

type Props = React.HTMLAttributes<HTMLElement> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "section" | "header" | "article";
};

export function Section({
  title,
  description,
  actions,
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <Tag className={`flex flex-col gap-4 ${className}`} {...rest}>
      {(title || actions || description) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {(title || description) && (
            <div className="flex flex-col gap-1">
              {title && <h2 className="text-title-2 text-primary">{title}</h2>}
              {description && (
                <p className="text-body-sm text-secondary">{description}</p>
              )}
            </div>
          )}
          {actions && (
            <div className="flex flex-col gap-2 min-[480px]:flex-row">
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </Tag>
  );
}
