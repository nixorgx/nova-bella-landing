export function PageHead({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  className?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={className ? `page-head ${className}` : "page-head"}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </header>
  );
}

export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="coming" aria-label={title}>
      <strong>{title}</strong>
      <p>{children}</p>
    </section>
  );
}
