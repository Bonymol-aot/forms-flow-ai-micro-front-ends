import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import {
  Form,
  getForm,
  getSubmission,
  resetSubmission,
} from "@aot-technologies/formio-react";
import { Formio } from "@aot-technologies/formiojs";
import { ReusableLargeModal, V8CustomButton } from "@formsflow/components";
import {
  claimM8flowTask,
  completeM8flowTask,
  fetchM8flowTaskList,
  getCustomSubmission,
  unclaimM8flowTask,
} from "../../api/services/bpmTaskServices";
import { executeRule, fetchTaskVariables } from "../../api/services/filterServices";
import { getFormIdSubmissionIdFromURL } from "../../api/services/formatterService";
import { getFormioRoleIds } from "../../api/services/userSrvices";
import {
  resetFormData,
  setBundleLoading,
  setBundleSelectedForms,
  setTaskAssignee,
  setTaskDetailsLoading,
} from "../../actions/taskActions";
import {
  CUSTOM_SUBMISSION_ENABLE,
  CUSTOM_SUBMISSION_URL,
} from "../../constants/index";
import { RESOURCE_BUNDLES_DATA } from "../../resourceBundles/i18n";
import { userRoles } from "../../helper/permissions";
import { useAppDispatch } from "../../hooks";
import BundleTaskForm from "../BundleTaskForm";
import Loading from "../Loading/Loading";

/**
 * Task list for m8flow-backed forms.
 *
 * Deliberately a separate table rather than a mode inside TaskListTable: that
 * table is driven by Camunda filter/column configuration and a Camunda task
 * payload, none of which m8flow has. m8flow assigns a human task to the group a
 * BPMN lane resolves to, and authorises the list itself from the caller's token,
 * so the columns worth showing are different too -- lane group instead of
 * Camunda roles, process model instead of filter attributes.
 */
interface M8flowTask {
  id: string;
  name: string;
  laneName?: string;
  assignedUserGroup?: string;
  processModelIdentifier?: string;
  processModelDisplayName?: string;
  processInstanceId?: number;
  processInstanceStatus?: string;
  initiator?: string;
  created?: number;
  /**
   * The submission behind the task. m8flow itself knows nothing about forms --
   * forms-flow-api joins its own application table on processInstanceId and
   * attaches these, so they are absent for a process started inside m8flow
   * rather than from a form.
   */
  applicationId?: number;
  applicationStatus?: string;
  formId?: string;
  submissionId?: string;
  formName?: string;
  formType?: string;
  formUrl?: string;
  /**
   * Who has claimed this task, or null when nobody has.
   *
   * The claim lives in forms-flow, not in m8flow: the engine has no claim of its
   * own, so this is advisory -- a potential owner working in m8flow's own UI can
   * still complete a task claimed here by someone else.
   */
  assignee?: string | null;
  claimedAt?: string | null;
}

interface FormReference {
  formId: string;
  submissionId: string;
}

/** m8flow timestamps are epoch *seconds*, not milliseconds. */
const formatCreated = (createdAtInSeconds?: number) => {
  if (!createdAtInSeconds) return "-";
  return new Date(createdAtInSeconds * 1000).toLocaleString();
};

/**
 * Find the formio form/submission a m8flow task points at.
 *
 * formId/submissionId are what forms-flow-api attaches to the task; formUrl is
 * accepted too so a task shaped like a Camunda one still opens. Returning null
 * lets the caller disable the button rather than open a modal that can never
 * load -- a task whose process was started inside m8flow has no submission at
 * all, and that is a normal state, not a failure.
 */
const resolveFormReference = (task: M8flowTask): FormReference | null => {
  if (task?.formId && task?.submissionId) {
    return { formId: task.formId, submissionId: task.submissionId };
  }
  if (task?.formUrl) {
    const { formId, submissionId } = getFormIdSubmissionIdFromURL(task.formUrl);
    if (formId && submissionId) return { formId, submissionId };
  }
  return null;
};

const M8flowTaskList: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [tasks, setTasks] = useState<M8flowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewedTask, setViewedTask] = useState<M8flowTask | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [bundleFormData, setBundleFormData] = useState<FormReference>({
    formId: "",
    submissionId: "",
  });
  const [bundleName, setBundleName] = useState("");
  // Which row has a claim/unclaim in flight, so only that row's buttons go busy.
  const [actioningTaskId, setActioningTaskId] = useState<string | null>(null);

  const { manageMyTasks, AssignTaskToOthers } = userRoles();
  const currentUser = useSelector(
    (state: any) => state.task?.userDetails?.preferred_username
  );

  const form = useSelector((state: any) => state.form?.form);
  const reduxSubmission = useSelector(
    (state: any) => state.submission?.submission
  );
  const customSubmission = useSelector(
    (state: any) => state.customSubmission?.submission ?? {}
  );
  const selectedForms = useSelector(
    (state: any) => state.task?.selectedForms || []
  );
  const rawSubmission =
    CUSTOM_SUBMISSION_URL && CUSTOM_SUBMISSION_ENABLE
      ? customSubmission
      : reduxSubmission;

  // Deep clone before handing the submission to formio: the Form component
  // writes into the object it is given, and that object is redux state. Passing
  // it straight through mutates the store, which redux reports on the next
  // dispatch as "A state mutation was detected ... 'submission.submission.data'"
  // -- the approve/reject flow dispatches immediately afterwards, so that is
  // where it surfaces. Same guard TaskForm uses for the Camunda task view.
  const submission = useMemo(
    () => (rawSubmission ? JSON.parse(JSON.stringify(rawSubmission)) : null),
    [rawSubmission]
  );

  const isBundle = viewedTask?.formType === "bundle";

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchM8flowTaskList()
      .then((res) => {
        setTasks(res?.data?.tasks || []);
      })
      .catch((err) => {
        // 403 here is a real answer, not a bug: m8flow only lets
        // tenant-admin / editor / reviewer / submitter read tasks, so say so
        // rather than showing an empty table that looks like "no work to do".
        const status = err?.response?.status;
        if (status === 403) {
          setError(
            t(
              "You do not have permission to read m8flow tasks. This needs one of the tenant-admin, editor, reviewer or submitter groups."
            )
          );
        } else {
          setError(
            err?.response?.data?.message || err?.message || String(err)
          );
        }
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Update one row's assignee in place.
   *
   * Claiming does not change which tasks the caller can see -- m8flow scopes the
   * list by lane membership, not by assignment -- so there is nothing to refetch.
   */
  const applyAssignee = useCallback(
    (taskId: string, assignee: string | null) => {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId ? { ...task, assignee } : task
        )
      );
    },
    []
  );

  const handleClaimAction = useCallback(
    (task: M8flowTask, action: "claim" | "unclaim") => {
      setActioningTaskId(task.id);
      setError(null);
      const request =
        action === "claim"
          ? claimM8flowTask(task.id, currentUser)
          : unclaimM8flowTask(task.id);

      request
        .then((res: any) => {
          // Trust the server's answer over the optimistic one: on claim it
          // confirms who ended up holding the task.
          applyAssignee(
            task.id,
            action === "claim" ? res?.data?.assignee ?? currentUser : null
          );
        })
        .catch((err: any) => {
          if (err?.response?.status === 409) {
            // Someone claimed it between the list loading and this click.
            // Reload so the table shows who actually holds it, rather than
            // leaving a Claim button that will keep failing.
            setError(t("This task was just claimed by someone else."));
            load();
            return;
          }
          setError(
            err?.response?.data?.message || err?.message || String(err)
          );
        })
        .finally(() => setActioningTaskId(null));
    },
    [applyAssignee, currentUser, load, t]
  );

  /**
   * Approve or reject a task, which advances the workflow.
   *
   * The list is reloaded rather than having the row removed: completing this task
   * can create the next one in the process, and that task may also be waiting on
   * the caller.
   */
  const handleComplete = useCallback(
    (
      task: M8flowTask,
      action: "Approved" | "Rejected",
      onSuccess?: () => void
    ) => {
      setActioningTaskId(task.id);
      setError(null);
      completeM8flowTask(task.id, action)
        .then(() => {
          onSuccess?.();
          load();
        })
        .catch((err: any) => {
          if (err?.response?.status === 409) {
            setError(t("This task is claimed by another user."));
            load();
            return;
          }
          setError(
            err?.response?.data?.message || err?.message || String(err)
          );
        })
        .finally(() => setActioningTaskId(null));
    },
    [load, t]
  );

  const loadFormSubmission = useCallback(
    ({ formId, submissionId }: FormReference) => {
      setFormLoading(true);
      Formio.clearCache();
      dispatch(resetFormData("form"));

      const onFormLoaded = () => {
        if (CUSTOM_SUBMISSION_URL && CUSTOM_SUBMISSION_ENABLE) {
          dispatch(getCustomSubmission(submissionId, formId));
        } else {
          dispatch(getSubmission("submission", submissionId, formId));
        }
        setFormLoading(false);
      };

      const fetchForm = () => {
        dispatch(
          getForm("form", formId, ((err: any) => {
            if (!err) {
              onFormLoaded();
            } else if (err === "Bad Token" || err === "Token Expired") {
              // The formio token can be stale on the first form opened in a
              // session; refresh the role ids and retry once before failing.
              dispatch(resetFormData("form"));
              dispatch(
                getFormioRoleIds((retryErr: any) => {
                  if (retryErr) {
                    setFormLoading(false);
                    setFormError(t("Unable to load the form."));
                  } else {
                    fetchForm();
                  }
                }) as any
              );
            } else {
              setFormLoading(false);
              setFormError(t("Unable to load the form."));
            }
          }) as any)
        );
      };

      fetchForm();
    },
    [dispatch, t]
  );

  /**
   * A bundle's submission spans several forms, so it is resolved the same way
   * the Camunda task list resolves it: look up the mapper behind the form, then
   * ask the rule engine which forms this submission actually used.
   */
  const loadBundle = useCallback(
    ({ formId, submissionId }: FormReference) => {
      Formio.clearCache();
      dispatch(resetFormData("form"));
      dispatch(setBundleLoading(true));
      setBundleFormData({ formId, submissionId });

      fetchTaskVariables(formId)
        .then((res) => {
          setBundleName(res.data.formName);
          return executeRule(
            { submissionType: "fetch", formId, submissionId },
            res.data.id
          ).then((ruleRes: { data: unknown }) => {
            dispatch(setBundleSelectedForms(ruleRes.data));
          });
        })
        .catch(() => {
          setFormError(t("Unable to load the form."));
        })
        .finally(() => {
          dispatch(setBundleLoading(false));
        });
    },
    [dispatch, t]
  );

  const handleView = useCallback(
    (task: M8flowTask) => {
      const formReference = resolveFormReference(task);
      if (!formReference) return;
      setViewedTask(task);
      setFormError(null);
      // BundleTaskForm derives read-only from the Camunda task assignee, which
      // can still be set from a Camunda task opened earlier in this session.
      // m8flow completes its human tasks through the engine rather than through
      // a formio submit, so clear it and keep this view read-only.
      dispatch(setTaskAssignee(null));
      dispatch(setTaskDetailsLoading(false));

      if (task.formType === "bundle") {
        loadBundle(formReference);
      } else {
        loadFormSubmission(formReference);
      }
    },
    [dispatch, loadBundle, loadFormSubmission]
  );

  const handleCloseView = useCallback(() => {
    setViewedTask(null);
    setFormError(null);
    setFormLoading(false);
    setBundleName("");
    setBundleFormData({ formId: "", submissionId: "" });
    Formio.clearCache();
    dispatch(resetSubmission("submission"));
    dispatch(resetFormData("form"));
    dispatch(setBundleSelectedForms([]));
  }, [dispatch]);

  const renderFormContent = () => {
    if (formError) {
      return (
        <div
          className="alert alert-danger m-3"
          role="alert"
          data-testid="m8flow-task-form-error"
        >
          {formError}
        </div>
      );
    }

    if (isBundle) {
      if (!selectedForms?.length) return <Loading />;
      return (
        <div className="scrollable-overview-with-header bg-white ps-3 pe-3 m-0 form-border pb-0 disabled-mode">
          <BundleTaskForm
            currentUser=""
            bundleFormData={bundleFormData}
          />
        </div>
      );
    }

    if (formLoading || !form || !submission?.data) {
      return <Loading />;
    }

    return (
      <div className="scrollable-overview-with-header bg-white ps-3 pe-3 m-0 form-border pb-0 disabled-mode">
        <div className="main-header">
          <h3 className="task-head text-truncate form-title">{form?.title}</h3>
        </div>
        <div className="ms-4 mb-5 me-4 wizard-tab service-task-details">
          {/* Read only: m8flow completes its human tasks through the engine, not
              through a formio submit, so this is a view of the submission. */}
          <Form
            src={form}
            submission={submission}
            options={{
              noAlerts: true,
              i18n: RESOURCE_BUNDLES_DATA,
              readOnly: true,
            }}
          />
        </div>
      </div>
    );
  };

  // The open task as it currently stands in the list, not the snapshot taken
  // when the modal opened -- the claim can change while it is open.
  const viewedTaskLive = viewedTask
    ? tasks.find((task) => task.id === viewedTask.id) ?? viewedTask
    : null;
  // A decision is only offered on a task the caller holds and has permission for.
  const decidableTask =
    viewedTaskLive &&
    manageMyTasks &&
    viewedTaskLive.assignee &&
    viewedTaskLive.assignee === currentUser
      ? viewedTaskLive
      : null;
  const isViewedTaskBusy = !!viewedTask && actioningTaskId === viewedTask.id;

  const modalTitle = () => {
    if (isBundle && bundleName) return bundleName;
    if (viewedTask?.applicationId) return String(viewedTask.applicationId);
    return viewedTask?.formName || viewedTask?.name || "";
  };

  return (
    <div className="m8flow-task-list">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="text-muted" data-testid="m8flow-task-count">
          {loading
            ? t("Loading tasks...")
            : `${tasks.length} ${t("task(s) waiting on your groups")}`}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={load}
          disabled={loading}
          data-testid="m8flow-task-refresh"
        >
          {t("Refresh")}
        </button>
      </div>

      {error && (
        <div
          className="alert alert-danger"
          role="alert"
          data-testid="m8flow-task-error"
        >
          {error}
        </div>
      )}

      <table className="table" data-testid="m8flow-task-table">
        <thead>
          <tr>
            <th>{t("Task")}</th>
            <th>{t("Lane group")}</th>
            <th>{t("Process model")}</th>
            <th>{t("Submitted by")}</th>
            <th>{t("Assigned to")}</th>
            <th>{t("Created")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {!loading && !tasks.length && !error && (
            <tr>
              <td colSpan={7} className="text-center text-muted">
                {t("No m8flow tasks found")}
              </td>
            </tr>
          )}
          {tasks.map((task) => {
            const formReference = resolveFormReference(task);
            const isBusy = actioningTaskId === task.id;
            const isMine = !!task.assignee && task.assignee === currentUser;
            // Taking a task off someone else is an assign-to-others act, so it
            // needs that permission rather than the weaker "manage my tasks".
            const canRelease = isMine ? manageMyTasks : AssignTaskToOthers;
            return (
              <tr key={task.id} data-testid={`m8flow-task-row-${task.id}`}>
                <td>{task.name || "-"}</td>
                {/* The lane is what the designer drew; the group is what m8flow
                    resolved it to for this tenant. Showing both makes a
                    misconfigured lane obvious. */}
                <td>
                  {task.assignedUserGroup || task.laneName || "-"}
                  {task.laneName &&
                    task.assignedUserGroup &&
                    !task.assignedUserGroup.endsWith(task.laneName) && (
                      <span className="text-muted"> ({task.laneName})</span>
                    )}
                </td>
                <td>
                  {task.processModelDisplayName ||
                    task.processModelIdentifier ||
                    "-"}
                </td>
                <td>{task.initiator || "-"}</td>
                {/* Who holds the task and the control that changes it, together:
                    the action only makes sense against the state it acts on. */}
                <td data-testid={`m8flow-task-assignee-${task.id}`}>
                  <div className="d-flex align-items-center gap-2">
                    {task.assignee ? (
                      <span>
                        {task.assignee}
                        {isMine && (
                          <span className="text-muted"> ({t("you")})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">{t("Unassigned")}</span>
                    )}
                    {!task.assignee && manageMyTasks && (
                      <V8CustomButton
                        label={t("Claim")}
                        variant="secondary"
                        onClick={() => handleClaimAction(task, "claim")}
                        disabled={isBusy}
                        ariaLabel={t("Claim this task")}
                        dataTestId={`m8flow-task-claim-${task.id}`}
                      />
                    )}
                    {task.assignee && canRelease && (
                      <V8CustomButton
                        label={t("Unclaim")}
                        variant="secondary"
                        onClick={() => handleClaimAction(task, "unclaim")}
                        disabled={isBusy}
                        ariaLabel={
                          isMine
                            ? t("Release this task")
                            : t("Release this task from its current assignee")
                        }
                        dataTestId={`m8flow-task-unclaim-${task.id}`}
                      />
                    )}
                  </div>
                </td>
                <td>{formatCreated(task.created)}</td>
                <td className="text-end">
                  <V8CustomButton
                    label={t("View")}
                    variant="secondary"
                    onClick={() => handleView(task)}
                    disabled={!formReference}
                    // A process started inside m8flow has no forms-flow
                    // submission behind it; say so instead of opening an empty
                    // modal.
                    ariaLabel={
                      formReference
                        ? t("View form")
                        : t("This task has no linked submission")
                    }
                    dataTestId={`m8flow-task-view-${task.id}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {viewedTask && (
        <ReusableLargeModal
          show={!!viewedTask}
          onClose={handleCloseView}
          title={modalTitle()}
          content={renderFormContent()}
          // The decision is offered only on a task you hold, so claiming is what
          // marks you as the one working it. Read from the live row rather than
          // the snapshot taken when the modal opened, so a claim made in the
          // meantime is reflected.
          primaryBtnText={decidableTask ? t("Approve") : undefined}
          primaryBtnAction={() =>
            decidableTask &&
            handleComplete(decidableTask, "Approved", handleCloseView)
          }
          primaryBtnDisable={isViewedTaskBusy}
          buttonLoading={isViewedTaskBusy}
          secondaryBtnText={decidableTask ? t("Reject") : undefined}
          secondaryBtnAction={() =>
            decidableTask &&
            handleComplete(decidableTask, "Rejected", handleCloseView)
          }
          secondaryBtnDisable={isViewedTaskBusy}
          secondaryBtnLoading={isViewedTaskBusy}
        />
      )}
    </div>
  );
};

export default M8flowTaskList;
