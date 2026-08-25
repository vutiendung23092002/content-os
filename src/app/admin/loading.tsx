const summaryCards = ["Tài khoản", "Đang hoạt động", "Chờ duyệt", "Quản trị"];

export default function AdminLoading() {
  return (
    <main className="contentPage" aria-busy="true" aria-live="polite">
      <div className="peopleWorkspace adminLoadingWorkspace">
        <span className="srOnly">Đang mở trang Nhân sự</span>
        <section className="peopleStats" aria-hidden="true">
          {summaryCards.map((label) => (
            <article className="adminLoadingCard" key={label}>
              <span>{label}</span>
              <i className="adminLoadingLine isValue" />
              <i className="adminLoadingLine" />
            </article>
          ))}
        </section>

        <div className="peopleLayout" aria-hidden="true">
          <section className="surfaceCard adminLoadingPanel">
            <i className="adminLoadingLine isEyebrow" />
            <i className="adminLoadingLine isHeading" />
            <i className="adminLoadingLine isCopy" />
            <i className="adminLoadingField" />
            <i className="adminLoadingField" />
            <i className="adminLoadingButton" />
          </section>

          <section className="surfaceCard adminLoadingPanel isList">
            <i className="adminLoadingLine isEyebrow" />
            <i className="adminLoadingLine isHeading" />
            {[0, 1, 2].map((row) => (
              <div className="adminLoadingRow" key={row}>
                <i className="adminLoadingAvatar" />
                <span>
                  <i className="adminLoadingLine isName" />
                  <i className="adminLoadingLine isEmail" />
                </span>
                <i className="adminLoadingAction" />
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
